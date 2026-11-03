#![cfg_attr(not(target_os = "android"), allow(dead_code))]

use serde::Serialize;

const MAX_BACKTRACE_FRAMES: usize = 64;
const MAX_TEXT_CHARS: usize = 4096;

/// Android's own record of how a process died, which the app can read on its next launch.
#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExitDetails {
    /// `ApplicationExitInfo.REASON_*`; 5 is a native crash, 3 is low memory.
    pub reason: i32,
    pub status: i32,
    pub importance: i32,
    pub pss_kb: i64,
    pub rss_kb: i64,
    pub description: Option<String>,
    #[serde(flatten)]
    pub tombstone: Tombstone,
}

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tombstone {
    pub signal: Option<String>,
    /// Names the abort site for bionic and ART checks, e.g. fdsan, FORTIFY, Scudo or CheckJNI.
    pub abort_message: Option<String>,
    pub cause: Option<String>,
    pub thread: Option<String>,
    /// The crashing thread in logcat's tombstone format, so `ndk-stack` can read it. Frames in our
    /// stripped library have no name until resolved with the release's symbols archive.
    pub backtrace: Option<String>,
}

enum Value<'a> {
    Varint(u64),
    Bytes(&'a [u8]),
    Fixed,
}

// Protobuf wire format. Reads only the AOSP tombstone.proto fields used below, without a dependency
// or generated code for the rest of a large schema, and stops at the first malformed field.
struct Fields<'a>(&'a [u8]);

impl<'a> Fields<'a> {
    fn varint(&mut self) -> Option<u64> {
        let mut value = 0u64;
        for shift in (0..64).step_by(7) {
            let (byte, rest) = self.0.split_first()?;
            self.0 = rest;
            value |= u64::from(byte & 0x7f) << shift;
            if byte & 0x80 == 0 {
                return Some(value);
            }
        }
        None
    }

    fn take(&mut self, length: usize) -> Option<&'a [u8]> {
        if length > self.0.len() {
            return None;
        }
        let (taken, rest) = self.0.split_at(length);
        self.0 = rest;
        Some(taken)
    }
}

impl<'a> Iterator for Fields<'a> {
    type Item = (u64, Value<'a>);

    fn next(&mut self) -> Option<Self::Item> {
        if self.0.is_empty() {
            return None;
        }
        let key = self.varint()?;
        let value = match key & 7 {
            0 => Value::Varint(self.varint()?),
            1 => {
                self.take(8)?;
                Value::Fixed
            }
            2 => {
                let length = usize::try_from(self.varint()?).ok()?;
                Value::Bytes(self.take(length)?)
            }
            5 => {
                self.take(4)?;
                Value::Fixed
            }
            _ => return None,
        };
        Some((key >> 3, value))
    }
}

fn text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes)
        .chars()
        .take(MAX_TEXT_CHARS)
        .collect()
}

fn frame_line(index: usize, frame: &[u8]) -> String {
    let (mut rel_pc, mut offset) = (0, 0);
    let (mut function, mut file, mut build_id) = (String::new(), String::new(), String::new());
    for (field, value) in Fields(frame) {
        match (field, value) {
            (1, Value::Varint(value)) => rel_pc = value,
            (5, Value::Varint(value)) => offset = value,
            (4, Value::Bytes(value)) => function = text(value),
            (6, Value::Bytes(value)) => file = text(value),
            (8, Value::Bytes(value)) => build_id = text(value),
            _ => {}
        }
    }
    let mut line = format!("#{index:02} pc {rel_pc:016x}  {file}");
    if !function.is_empty() {
        line += &format!(" ({function}+{offset})");
    }
    if !build_id.is_empty() {
        line += &format!(" (BuildId: {build_id})");
    }
    line
}

pub fn parse_tombstone(bytes: &[u8]) -> Tombstone {
    let mut crashed_tid = 0;
    let mut tombstone = Tombstone::default();
    let mut threads = Vec::new();
    for (field, value) in Fields(bytes) {
        match (field, value) {
            (6, Value::Varint(tid)) => crashed_tid = tid,
            (10, Value::Bytes(signal)) => {
                let (mut name, mut code) = (String::new(), String::new());
                for (field, value) in Fields(signal) {
                    match (field, value) {
                        (2, Value::Bytes(value)) => name = text(value),
                        (4, Value::Bytes(value)) => code = text(value),
                        _ => {}
                    }
                }
                tombstone.signal = Some(format!("{name} ({code})"));
            }
            (14, Value::Bytes(message)) if !message.is_empty() => {
                tombstone.abort_message = Some(text(message));
            }
            (15, Value::Bytes(cause)) if tombstone.cause.is_none() => {
                tombstone.cause = Fields(cause).find_map(|field| match field {
                    (1, Value::Bytes(value)) => Some(text(value)),
                    _ => None,
                });
            }
            // map<uint32, Thread> is a repeated { key = 1, value = 2 }, keyed by thread id.
            (16, Value::Bytes(entry)) => {
                let (mut tid, mut thread) = (0, None);
                for (field, value) in Fields(entry) {
                    match (field, value) {
                        (1, Value::Varint(value)) => tid = value,
                        (2, Value::Bytes(value)) => thread = Some(value),
                        _ => {}
                    }
                }
                if let Some(thread) = thread {
                    threads.push((tid, thread));
                }
            }
            _ => {}
        }
    }
    if let Some((_, thread)) = threads.iter().find(|(tid, _)| *tid == crashed_tid) {
        let mut frames = Vec::new();
        for (field, value) in Fields(thread) {
            match (field, value) {
                (2, Value::Bytes(name)) => tombstone.thread = Some(text(name)),
                (4, Value::Bytes(frame)) if frames.len() < MAX_BACKTRACE_FRAMES => {
                    frames.push(frame_line(frames.len(), frame));
                }
                _ => {}
            }
        }
        if !frames.is_empty() {
            tombstone.backtrace = Some(frames.join("\n"));
        }
    }
    tombstone
}

/// The most recent exit of each pid, with its time in milliseconds since the epoch. Empty below
/// Android 11, which has no exit records; tombstones in them need Android 12.
#[cfg(target_os = "android")]
pub fn read_exits(
    webview: &tauri::Webview,
    pids: Vec<u32>,
) -> Result<Vec<(u32, i64, ExitDetails)>, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    webview
        .with_webview(move |platform| {
            platform.jni_handle().exec(move |env, activity, _| {
                let result = read_android_exits(env, activity, &pids);
                if result.is_err() {
                    // A pending Java exception would be rethrown on the UI thread and crash the app.
                    let _ = env.exception_clear();
                }
                let _ = tx.send(result.map_err(|error| error.to_string()));
            });
        })
        .map_err(|error| error.to_string())?;
    rx.recv().map_err(|error| error.to_string())?
}

#[cfg(target_os = "android")]
const REASON_CRASH_NATIVE: i32 = 5;

#[cfg(target_os = "android")]
fn read_android_exits(
    env: &mut jni::JNIEnv,
    activity: &jni::objects::JObject,
    pids: &[u32],
) -> jni::errors::Result<Vec<(u32, i64, ExitDetails)>> {
    let sdk = env
        .get_static_field("android/os/Build$VERSION", "SDK_INT", "I")?
        .i()?;
    if sdk < 30 {
        return Ok(Vec::new());
    }
    let service = env.new_string("activity")?;
    let manager = env
        .call_method(
            activity,
            "getSystemService",
            "(Ljava/lang/String;)Ljava/lang/Object;",
            &[(&service).into()],
        )?
        .l()?;
    let mut exits = Vec::new();
    for &pid in pids {
        let list = env
            .call_method(
                &manager,
                "getHistoricalProcessExitReasons",
                "(Ljava/lang/String;II)Ljava/util/List;",
                &[
                    (&jni::objects::JObject::null()).into(),
                    (pid as i32).into(),
                    1.into(),
                ],
            )?
            .l()?;
        if env.call_method(&list, "size", "()I", &[])?.i()? == 0 {
            continue;
        }
        let exit = env
            .call_method(&list, "get", "(I)Ljava/lang/Object;", &[0.into()])?
            .l()?;
        let description = env
            .call_method(&exit, "getDescription", "()Ljava/lang/String;", &[])?
            .l()?;
        let description = if description.is_null() {
            None
        } else {
            Some(text(
                env.get_string(&jni::objects::JString::from(description))?
                    .to_string_lossy()
                    .as_bytes(),
            ))
        };
        let reason = env.call_method(&exit, "getReason", "()I", &[])?.i()?;
        let tombstone = if reason == REASON_CRASH_NATIVE {
            // Losing the tombstone must not cost the reason and memory figures read alongside it.
            read_tombstone(env, &exit).unwrap_or_else(|_| {
                let _ = env.exception_clear();
                Tombstone::default()
            })
        } else {
            Tombstone::default()
        };
        exits.push((
            pid,
            env.call_method(&exit, "getTimestamp", "()J", &[])?.j()?,
            ExitDetails {
                reason,
                status: env.call_method(&exit, "getStatus", "()I", &[])?.i()?,
                importance: env.call_method(&exit, "getImportance", "()I", &[])?.i()?,
                pss_kb: env.call_method(&exit, "getPss", "()J", &[])?.j()?,
                rss_kb: env.call_method(&exit, "getRss", "()J", &[])?.j()?,
                description,
                tombstone,
            },
        ));
    }
    Ok(exits)
}

#[cfg(target_os = "android")]
fn read_tombstone(
    env: &mut jni::JNIEnv,
    exit: &jni::objects::JObject,
) -> jni::errors::Result<Tombstone> {
    let stream = env
        .call_method(exit, "getTraceInputStream", "()Ljava/io/InputStream;", &[])?
        .l()?;
    if stream.is_null() {
        return Ok(Tombstone::default());
    }
    let buffer = env.new_byte_array(64 * 1024)?;
    let mut bytes = Vec::new();
    loop {
        let read = env
            .call_method(&stream, "read", "([B)I", &[(&buffer).into()])?
            .i()?;
        if read < 0 {
            break;
        }
        bytes.extend_from_slice(&env.convert_byte_array(&buffer)?[..read as usize]);
    }
    env.call_method(&stream, "close", "()V", &[])?;
    Ok(parse_tombstone(&bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn varint(mut value: u64, out: &mut Vec<u8>) {
        while value >= 0x80 {
            out.push(value as u8 | 0x80);
            value >>= 7;
        }
        out.push(value as u8);
    }

    fn number(field: u64, value: u64) -> Vec<u8> {
        let mut out = Vec::new();
        varint(field << 3, &mut out);
        varint(value, &mut out);
        out
    }

    fn message(field: u64, value: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        varint(field << 3 | 2, &mut out);
        varint(value.len() as u64, &mut out);
        out.extend_from_slice(value);
        out
    }

    fn fixed(field: u64, wire_type: u64, width: usize) -> Vec<u8> {
        let mut out = Vec::new();
        varint(field << 3 | wire_type, &mut out);
        out.resize(out.len() + width, 0xff);
        out
    }

    fn thread_entry(tid: u64, name: &str, frames: &[Vec<u8>]) -> Vec<u8> {
        let mut thread = message(2, name.as_bytes());
        for frame in frames {
            thread.extend(message(4, frame));
        }
        let mut entry = number(1, tid);
        entry.extend(message(2, &thread));
        message(16, &entry)
    }

    // Hand-encoded from AOSP's tombstone.proto so the expected values don't come from the parser.
    fn sample_tombstone() -> Vec<u8> {
        let abort_frame = [
            number(1, 0x5b1f4),
            message(4, b"abort"),
            number(5, 164),
            message(6, b"/apex/com.android.runtime/lib64/bionic/libc.so"),
            message(8, b"libcbuild"),
        ]
        .concat();
        let our_frame = [number(1, 0x1234), message(6, b"libmyelin_lib.so")].concat();
        let signal = [
            number(1, 6),
            message(2, b"SIGABRT"),
            number(3, 0xffff_fffa),
            message(4, b"SI_TKILL"),
        ]
        .concat();
        [
            number(1, 1),
            number(5, 4242),
            number(6, 4243),
            // Fixed-width fields from a newer schema must be skipped, not end the parse early.
            fixed(99, 1, 8),
            fixed(98, 5, 4),
            message(10, &signal),
            message(14, b"fdsan: double close"),
            message(15, &message(1, b"[GWP-ASan]: Use After Free")),
            thread_entry(4242, "main", &[]),
            thread_entry(4243, "tokio-runtime-w", &[abort_frame, our_frame]),
        ]
        .concat()
    }

    #[test]
    fn reads_the_crashing_thread_from_a_tombstone() {
        let tombstone = parse_tombstone(&sample_tombstone());
        assert_eq!(tombstone.signal.as_deref(), Some("SIGABRT (SI_TKILL)"));
        assert_eq!(
            tombstone.abort_message.as_deref(),
            Some("fdsan: double close")
        );
        assert_eq!(
            tombstone.cause.as_deref(),
            Some("[GWP-ASan]: Use After Free")
        );
        assert_eq!(tombstone.thread.as_deref(), Some("tokio-runtime-w"));
        assert_eq!(
            tombstone.backtrace.as_deref(),
            Some(
                "#00 pc 000000000005b1f4  /apex/com.android.runtime/lib64/bionic/libc.so \
                 (abort+164) (BuildId: libcbuild)\n\
                 #01 pc 0000000000001234  libmyelin_lib.so"
            )
        );
    }

    #[test]
    fn survives_truncated_tombstones() {
        let bytes = sample_tombstone();
        for length in 0..bytes.len() {
            parse_tombstone(&bytes[..length]);
        }
    }
}
