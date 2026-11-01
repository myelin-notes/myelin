use std::{
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard},
};

use git2::{
    build::{RepoBuilder, TreeUpdateBuilder},
    AutotagOption, Cred, FetchOptions, FileMode, ObjectType, Oid, PushOptions, Reference,
    RemoteCallbacks, Repository, Signature, TreeWalkMode, TreeWalkResult,
};
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitPushFile {
    pub(crate) path: String,
    pub(crate) index: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitPushRequest {
    pub(crate) owner: String,
    pub(crate) repo: String,
    pub(crate) branch: String,
    pub(crate) token: String,
    pub(crate) expected_head_oid: String,
    pub(crate) message: String,
    pub(crate) staging_id: String,
    pub(crate) additions: Vec<GitPushFile>,
    pub(crate) deletions: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitPushResponse {
    pub(crate) status: &'static str,
    pub(crate) commit_oid: Option<String>,
    pub(crate) failure_reason: Option<String>,
}

pub(crate) fn push_batch(
    cache_dir: &Path,
    request: GitPushRequest,
) -> Result<GitPushResponse, String> {
    if request.staging_id.len() != 36
        || !request
            .staging_id
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() || byte == b'-')
        || !valid_slug(&request.owner)
        || !valid_slug(&request.repo)
        || !Reference::is_valid_name(&format!("refs/heads/{}", request.branch))
        || Oid::from_str(&request.expected_head_oid).is_err()
        || request.additions.iter().any(|file| !valid_path(&file.path))
        || request.deletions.iter().any(|path| !valid_path(path))
    {
        return Err("Invalid Git push request".into());
    }

    let stage = cache_dir.join("git-sync").join(&request.staging_id);
    let repo_path = repository_cache(cache_dir, &request.owner, &request.repo);
    let url = format!("https://github.com/{}/{}.git", request.owner, request.repo);
    push_batch_to_url(&stage, &repo_path, &url, request)
}

fn valid_slug(value: &str) -> bool {
    !value.is_empty()
        && value != "."
        && value != ".."
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
}

fn valid_path(value: &str) -> bool {
    !value.is_empty()
        && value.split('/').all(|part| {
            !part.is_empty()
                && part != "."
                && part != ".."
                && !part.contains('\\')
                && !part.contains('\0')
        })
}

pub(crate) fn git_failure(label: &str, error: git2::Error) -> String {
    format!("{label} ({:?}/{:?})", error.class(), error.code())
}

fn find_parent<'a>(
    repo: &'a Repository,
    branch: &str,
    was_cached: bool,
) -> Result<git2::Commit<'a>, String> {
    let prefix = if was_cached {
        "refs/remotes/origin"
    } else {
        "refs/heads"
    };
    repo.find_reference(&format!("{prefix}/{branch}"))
        .and_then(|head| head.peel_to_commit())
        .map_err(|error| git_failure("Git head unavailable", error))
}

static GIT_LOCK: Mutex<()> = Mutex::new(());

// ponytail: one lock serializes repository cache writes; split by repository if sync throughput needs it.
pub(crate) fn lock_git() -> Result<MutexGuard<'static, ()>, String> {
    let _waiting = crate::repository_engine::telemetry::current().phase("git_lock_wait");
    GIT_LOCK.lock().map_err(|_| "Git lock unavailable".into())
}

// openssl-src builds Android with `no-stdio`, so OpenSSL cannot read a CA file from disk and
// `git2::opts::set_ssl_cert_file` always fails there.
#[cfg(target_os = "android")]
fn trust_bundled_certificates() -> Result<(), String> {
    static TRUSTED: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    let trusted = TRUSTED.get_or_init(|| unsafe {
        libgit2_sys::init();
        let bundle = include_bytes!("../resources/cacert.pem");
        let bio = openssl_sys::BIO_new_mem_buf(bundle.as_ptr().cast(), bundle.len() as libc::c_int);
        if bio.is_null() {
            return false;
        }
        let mut all_added = true;
        let mut count = 0;
        loop {
            let certificate = openssl_sys::PEM_read_bio_X509(
                bio,
                std::ptr::null_mut(),
                None,
                std::ptr::null_mut(),
            );
            if certificate.is_null() {
                break;
            }
            all_added &= libgit2_sys::git_libgit2_opts(
                libgit2_sys::GIT_OPT_ADD_SSL_X509_CERT as libc::c_int,
                certificate,
            ) == 0;
            openssl_sys::X509_free(certificate);
            count += 1;
        }
        openssl_sys::BIO_free_all(bio);
        // The end of the bundle reads as an error; left queued, SSL_get_error would misreport the
        // next TLS call on this thread.
        openssl_sys::ERR_clear_error();
        all_added && count > 0
    });
    trusted
        .then_some(())
        .ok_or_else(|| "Git TLS certificates unavailable".into())
}

/// Fetches `branch` into the bare cache at `repo_path`, cloning on first use, and returns its
/// head. The caller must hold [`lock_git`]; `scratch` must be an existing, empty directory.
pub(crate) fn fetch_head(
    scratch: &Path,
    repo_path: &Path,
    url: &str,
    branch: &str,
    token: &str,
) -> Result<(Repository, Oid), String> {
    let trace = crate::repository_engine::telemetry::current();
    #[cfg(target_os = "android")]
    trust_bundled_certificates()?;
    // Same bound as the REST client; a stalled fetch could otherwise hold the sync locks.
    unsafe {
        git2::opts::set_server_connect_timeout_in_milliseconds(30_000)
            .and_then(|_| git2::opts::set_server_timeout_in_milliseconds(120_000))
    }
    .map_err(|error| git_failure("Git timeout unavailable", error))?;
    let received = std::cell::Cell::new(0);
    let mut fetch_callbacks = RemoteCallbacks::new();
    fetch_callbacks.credentials(|_, _, _| Cred::userpass_plaintext("x-access-token", token));
    fetch_callbacks.transfer_progress(|progress| {
        received.set(progress.received_bytes());
        true
    });
    let mut fetch_options = FetchOptions::new();
    if url.starts_with("https://") {
        fetch_options.depth(1);
    }
    fetch_options
        .download_tags(AutotagOption::None)
        .remote_callbacks(fetch_callbacks);
    let mut cached = Repository::open_bare(repo_path).ok();
    if cached
        .as_ref()
        .is_some_and(|repo| outgrown(repo, repo_path, branch))
    {
        // Dropped before the directory is removed; Windows refuses to delete open pack files.
        cached = None;
        trace.set("git_cache_reset", true);
    }
    let was_cached = cached.is_some();
    if !was_cached && repo_path.exists() {
        std::fs::remove_dir_all(repo_path).map_err(|_| "Git cache unavailable")?;
    }
    trace.set("git_cache_hit", was_cached);
    let fetching = trace.phase("git_fetch");
    let repo = if let Some(repo) = cached {
        let refspec = format!("+refs/heads/{branch}:refs/remotes/origin/{branch}");
        repo.find_remote("origin")
            .and_then(|mut remote| remote.fetch(&[&refspec], Some(&mut fetch_options), None))
            .map_err(|error| git_failure("Git fetch failed", error))?;
        repo
    } else {
        let cloned = RepoBuilder::new()
            .bare(true)
            .branch(branch)
            .fetch_options(fetch_options)
            .clone(url, &scratch.join("repo"))
            .map_err(|error| git_failure("Git clone failed", error))?;
        drop(cloned);
        std::fs::create_dir_all(repo_path.parent().ok_or("Git cache path unavailable")?)
            .map_err(|_| "Git cache unavailable")?;
        std::fs::rename(scratch.join("repo"), repo_path).map_err(|_| "Git cache unavailable")?;
        Repository::open_bare(repo_path).map_err(|_| "Git cache unavailable")?
    };
    drop(fetching);
    trace.add("git_received_bytes", received.get() as u64);
    let head = find_parent(&repo, branch, was_cached)?.id();
    Ok((repo, head))
}

// libgit2 never garbage-collects, so every version a fetch or push adds stays on disk. A re-clone
// costs one download of the current tree, so wait until stale versions outweigh it about twice;
// the 64 MiB floor keeps small repositories from re-cloning on most syncs.
fn outgrown(repo: &Repository, repo_path: &Path, branch: &str) -> bool {
    let Some(tree) = find_parent(repo, branch, true)
        .or_else(|_| find_parent(repo, branch, false))
        .ok()
        .and_then(|head| head.tree().ok())
    else {
        return false;
    };
    let Ok(odb) = repo.odb() else {
        return false;
    };
    let mut current = 0;
    let walked = tree.walk(TreeWalkMode::PreOrder, |_, entry| {
        if entry.kind() == Some(ObjectType::Blob) {
            current += odb
                .read_header(entry.id())
                .map_or(0, |(size, _)| size as u64);
        }
        TreeWalkResult::Ok
    });
    walked.is_ok() && directory_size(repo_path) > current * 3 + 64 * 1024 * 1024
}

fn directory_size(path: &Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(path) else {
        return 0;
    };
    entries
        .flatten()
        .map(|entry| match entry.file_type() {
            Ok(kind) if kind.is_dir() => directory_size(&entry.path()),
            Ok(kind) if kind.is_file() => entry.metadata().map_or(0, |metadata| metadata.len()),
            _ => 0,
        })
        .sum()
}

pub(crate) fn repository_cache(cache_dir: &Path, owner: &str, repo: &str) -> PathBuf {
    cache_dir
        .join("git-sync")
        .join("repositories")
        .join(owner)
        .join(repo)
}

fn push_batch_to_url(
    stage: &Path,
    repo_path: &Path,
    url: &str,
    request: GitPushRequest,
) -> Result<GitPushResponse, String> {
    let _lock = lock_git()?;
    let token = request.token;
    let (repo, head) = fetch_head(stage, repo_path, url, &request.branch, &token)?;
    let trace = crate::repository_engine::telemetry::current();
    let building = trace.phase("git_build_commit");
    let refname = format!("refs/heads/{}", request.branch);
    let parent = repo
        .find_commit(head)
        .map_err(|error| git_failure("Git head unavailable", error))?;
    if parent.id().to_string() != request.expected_head_oid {
        return Ok(GitPushResponse {
            status: "head-conflict",
            commit_oid: None,
            failure_reason: None,
        });
    }

    let baseline = parent
        .tree()
        .map_err(|error| git_failure("Git tree unavailable", error))?;
    let mut updates = TreeUpdateBuilder::new();
    for file in &request.additions {
        let blob = repo
            .blob_path(&stage.join(file.index.to_string()))
            .map_err(|error| git_failure("Git blob write failed", error))?;
        updates.upsert(&file.path, blob, FileMode::Blob);
    }
    for path in &request.deletions {
        if baseline.get_path(Path::new(path)).is_ok() {
            updates.remove(path);
        }
    }
    let tree_id = updates
        .create_updated(&repo, &baseline)
        .map_err(|error| git_failure("Git tree update failed", error))?;
    if tree_id == baseline.id() {
        return Ok(GitPushResponse {
            status: "pushed",
            commit_oid: Some(parent.id().to_string()),
            failure_reason: None,
        });
    }
    let tree = repo
        .find_tree(tree_id)
        .map_err(|error| git_failure("Git tree unavailable", error))?;
    let signature = Signature::now("Myelin Notes", "admin@trymyelin.app")
        .map_err(|error| git_failure("Git commit identity failed", error))?;
    let commit = repo
        .commit(
            None,
            &signature,
            &signature,
            &request.message,
            &tree,
            &[&parent],
        )
        .map_err(|error| git_failure("Git commit failed", error))?;

    drop(building);
    let _pushing = trace.phase("git_push");
    let mut push_callbacks = RemoteCallbacks::new();
    push_callbacks.credentials(|_, _, _| Cred::userpass_plaintext("x-access-token", &token));
    let rejected = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let rejected_in_callback = rejected.clone();
    push_callbacks.push_update_reference(move |_, status| {
        if status.is_some() {
            rejected_in_callback.store(true, std::sync::atomic::Ordering::Relaxed);
        }
        Ok(())
    });
    let mut push_options = PushOptions::new();
    push_options.remote_callbacks(push_callbacks);
    let push_result = repo.find_remote("origin").and_then(|mut remote| {
        remote.push(&[format!("{commit}:{refname}")], Some(&mut push_options))
    });
    let failure_reason = push_result
        .err()
        .map(|error| git_failure("Git push failed", error))
        .or_else(|| {
            rejected
                .load(std::sync::atomic::Ordering::Relaxed)
                .then(|| "Git push rejected".into())
        });
    Ok(GitPushResponse {
        status: if failure_reason.is_none() {
            "pushed"
        } else {
            "push-failed"
        },
        commit_oid: Some(commit.to_string()),
        failure_reason,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Write;

    #[test]
    fn git_diagnostics_exclude_native_error_messages() {
        let error = git2::Error::new(
            git2::ErrorCode::Auth,
            git2::ErrorClass::Http,
            "token=secret",
        );
        assert_eq!(
            git_failure("Git clone failed", error),
            "Git clone failed (Http/Auth)"
        );
    }

    #[test]
    fn pushes_real_size_blob_at_original_path_and_detects_stale_head() {
        let root = std::env::temp_dir().join(format!(
            "myelin-git-push-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        let bare_path = root.join("bare.git");
        let seed_path = root.join("seed.git");
        fs::create_dir_all(&root).expect("test directory");
        git2::Repository::init_bare(&bare_path).expect("remote repository");
        let seed = git2::Repository::init_bare(&seed_path).expect("seed repository");
        let keep = seed.blob(b"keep").expect("keep blob");
        let removed = seed.blob(b"remove").expect("removed blob");
        let mut files = seed.treebuilder(None).expect("files tree");
        files
            .insert("keep.myelin", keep, 0o100644)
            .expect("keep entry");
        files
            .insert("remove.myelin", removed, 0o100644)
            .expect("remove entry");
        let files_id = files.write().expect("files tree id");
        let mut root_tree = seed.treebuilder(None).expect("root tree");
        root_tree
            .insert("files", files_id, 0o040000)
            .expect("files entry");
        let root_tree_id = root_tree.write().expect("root tree id");
        let tree = seed.find_tree(root_tree_id).expect("initial tree");
        let signature = Signature::now("Test", "test@example.invalid").expect("identity");
        let head = seed
            .commit(
                Some("refs/heads/main"),
                &signature,
                &signature,
                "seed",
                &tree,
                &[],
            )
            .expect("initial commit");
        assert_eq!(
            find_parent(&seed, "main", false)
                .expect("initial clone head")
                .id(),
            head
        );
        assert!(find_parent(&seed, "main", true).is_err());
        drop(tree);
        let mut remote = seed
            .remote("origin", bare_path.to_str().expect("bare path"))
            .expect("remote");
        remote
            .push(&["refs/heads/main:refs/heads/main"], None)
            .expect("seed push");

        let stage = root.join("stage");
        fs::create_dir_all(&stage).expect("stage directory");
        let mut large_file = fs::File::create(stage.join("0")).expect("large file");
        let mut state = 0x1234_5678_u32;
        let mut chunk = [0_u8; 64 * 1024];
        let mut remaining = 73_873_604;
        while remaining > 0 {
            for byte in &mut chunk {
                state ^= state << 13;
                state ^= state >> 17;
                state ^= state << 5;
                *byte = (state >> 24) as u8;
            }
            let count = remaining.min(chunk.len());
            large_file
                .write_all(&chunk[..count])
                .expect("large file bytes");
            remaining -= count;
        }
        drop(large_file);
        let request = GitPushRequest {
            owner: "example".into(),
            repo: "notes".into(),
            branch: "main".into(),
            token: String::new(),
            expected_head_oid: head.to_string(),
            message: "Sync import".into(),
            staging_id: "00000000-0000-0000-0000-000000000001".into(),
            additions: vec![GitPushFile {
                path: "files/new.myelin".into(),
                index: 0,
            }],
            deletions: vec!["files/remove.myelin".into()],
        };
        let repo_path = root.join("cache.git");
        let result = push_batch_to_url(
            &stage,
            &repo_path,
            bare_path.to_str().expect("bare path"),
            request,
        )
        .expect("push succeeds");
        assert_eq!(result.status, "pushed");
        let pushed = git2::Repository::open_bare(&bare_path).expect("pushed repository");
        let pushed_head = pushed
            .find_reference("refs/heads/main")
            .expect("main reference")
            .peel_to_commit()
            .expect("main commit");
        assert_eq!(Some(pushed_head.id().to_string()), result.commit_oid);
        let tree = pushed_head.tree().expect("pushed tree");
        let blob = tree
            .get_path(Path::new("files/new.myelin"))
            .expect("new file");
        assert_eq!(
            pushed.find_blob(blob.id()).expect("new blob").size(),
            73_873_604
        );
        assert!(tree.get_path(Path::new("files/keep.myelin")).is_ok());
        assert!(tree.get_path(Path::new("files/remove.myelin")).is_err());

        let next_stage = root.join("next");
        fs::create_dir_all(&next_stage).expect("next stage");
        fs::write(next_stage.join("0"), b"next").expect("next file");
        let next = push_batch_to_url(
            &next_stage,
            &repo_path,
            bare_path.to_str().expect("bare path"),
            GitPushRequest {
                owner: "example".into(),
                repo: "notes".into(),
                branch: "main".into(),
                token: String::new(),
                expected_head_oid: result.commit_oid.clone().expect("first commit"),
                message: "Next update".into(),
                staging_id: "00000000-0000-0000-0000-000000000003".into(),
                additions: vec![GitPushFile {
                    path: "files/next.myelin".into(),
                    index: 0,
                }],
                deletions: vec![],
            },
        )
        .expect("cached push succeeds");
        assert_eq!(next.status, "pushed");

        let retry_stage = root.join("retry");
        fs::create_dir_all(&retry_stage).expect("retry stage");
        fs::write(retry_stage.join("0"), b"keep").expect("unchanged file");
        let retry = push_batch_to_url(
            &retry_stage,
            &repo_path,
            bare_path.to_str().expect("bare path"),
            GitPushRequest {
                owner: "example".into(),
                repo: "notes".into(),
                branch: "main".into(),
                token: String::new(),
                expected_head_oid: next.commit_oid.clone().expect("next commit"),
                message: "Retry update".into(),
                staging_id: "00000000-0000-0000-0000-000000000004".into(),
                additions: vec![GitPushFile {
                    path: "files/keep.myelin".into(),
                    index: 0,
                }],
                deletions: vec!["files/remove.myelin".into()],
            },
        )
        .expect("unchanged push succeeds");
        assert_eq!(retry.status, "pushed");
        assert_eq!(retry.commit_oid, next.commit_oid);

        let conflict_stage = root.join("conflict");
        fs::create_dir_all(&conflict_stage).expect("conflict directory");
        let conflict = push_batch_to_url(
            &conflict_stage,
            &repo_path,
            bare_path.to_str().expect("bare path"),
            GitPushRequest {
                owner: "example".into(),
                repo: "notes".into(),
                branch: "main".into(),
                token: String::new(),
                expected_head_oid: head.to_string(),
                message: "Stale update".into(),
                staging_id: "00000000-0000-0000-0000-000000000002".into(),
                additions: vec![],
                deletions: vec![],
            },
        )
        .expect("conflict response");
        assert_eq!(conflict.status, "head-conflict");
        drop(tree);
        drop(pushed_head);
        drop(pushed);
        drop(remote);
        drop(root_tree);
        drop(files);
        drop(seed);
        fs::remove_dir_all(root).expect("remove test directory");
    }

    #[test]
    fn reclones_a_cache_that_outgrew_the_current_tree() {
        let root = std::env::temp_dir().join(format!(
            "myelin-git-cache-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        let remote_path = root.join("remote.git");
        let remote = Repository::init_bare(&remote_path).expect("remote repository");
        let note = remote.blob(b"current note").expect("note blob");
        let mut builder = remote.treebuilder(None).expect("tree");
        builder
            .insert("note.myelin", note, 0o100644)
            .expect("note entry");
        let tree_id = builder.write().expect("tree id");
        drop(builder);
        let tree = remote.find_tree(tree_id).expect("tree");
        let signature = Signature::now("Test", "test@example.invalid").expect("identity");
        let head = remote
            .commit(
                Some("refs/heads/main"),
                &signature,
                &signature,
                "seed",
                &tree,
                &[],
            )
            .expect("commit");
        let url = remote_path.to_str().expect("remote path");
        let cache_path = root.join("cache.git");
        let fetch = |name: &str| {
            let scratch = root.join(name);
            fs::create_dir_all(&scratch).expect("scratch directory");
            let _lock = lock_git().expect("git lock");
            fetch_head(&scratch, &cache_path, url, "main", "").expect("fetch")
        };
        fetch("clone");

        let small = Repository::open_bare(&cache_path)
            .expect("cache")
            .blob(b"an old version")
            .expect("small garbage");
        let (cache, fetched) = fetch("kept");
        assert_eq!(fetched, head);
        assert!(cache.find_blob(small).is_ok(), "a modest cache is reused");
        drop(cache);

        let mut state = 0x9e37_79b9_u32;
        let large: Vec<u8> = (0..70 * 1024 * 1024)
            .map(|_| {
                state ^= state << 13;
                state ^= state >> 17;
                state ^= state << 5;
                (state >> 24) as u8
            })
            .collect();
        let large = Repository::open_bare(&cache_path)
            .expect("cache")
            .blob(&large)
            .expect("large garbage");
        let (cache, fetched) = fetch("reset");
        assert_eq!(fetched, head);
        assert!(
            cache.find_blob(large).is_err(),
            "an outgrown cache is re-cloned"
        );
        assert!(cache.find_blob(note).is_ok());
        drop(cache);
        drop(tree);
        drop(remote);
        fs::remove_dir_all(root).expect("remove test directory");
    }
}
