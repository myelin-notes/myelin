use std::{collections::HashMap, path::Path};

use git2::{
    build::{RepoBuilder, TreeUpdateBuilder},
    AutotagOption, Cred, FetchOptions, FileMode, Oid, PushOptions, Reference, RemoteCallbacks,
    Repository, Signature,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitPushFile {
    path: String,
    index: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitPushRequest {
    owner: String,
    repo: String,
    branch: String,
    token: String,
    expected_head_oid: String,
    message: String,
    staging_id: String,
    additions: Vec<GitPushFile>,
    deletions: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitPushResponse {
    status: &'static str,
    commit_oid: Option<String>,
    blob_shas: HashMap<String, String>,
    failure_reason: Option<String>,
}

#[tauri::command]
pub async fn github_push_batch(
    app: AppHandle,
    request: GitPushRequest,
) -> Result<GitPushResponse, String> {
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|_| "Could not resolve Git staging directory")?;
    tokio::task::spawn_blocking(move || push_batch(&cache_dir, request))
        .await
        .map_err(|_| "Git push task failed")?
}

fn push_batch(cache_dir: &Path, request: GitPushRequest) -> Result<GitPushResponse, String> {
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
    let repo_path = cache_dir
        .join("git-sync")
        .join("repositories")
        .join(&request.owner)
        .join(&request.repo);
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

fn git_failure(label: &str, error: git2::Error) -> String {
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

fn push_batch_to_url(
    stage: &Path,
    repo_path: &Path,
    url: &str,
    request: GitPushRequest,
) -> Result<GitPushResponse, String> {
    static GIT_PUSH_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    // ponytail: one lock serializes repository cache writes; split by repository if sync throughput needs it.
    let _lock = GIT_PUSH_LOCK
        .lock()
        .map_err(|_| "Git push lock unavailable")?;
    let token = request.token;
    let mut fetch_callbacks = RemoteCallbacks::new();
    fetch_callbacks.credentials(|_, _, _| Cred::userpass_plaintext("x-access-token", &token));
    let mut fetch_options = FetchOptions::new();
    if url.starts_with("https://") {
        fetch_options.depth(1);
    }
    fetch_options
        .download_tags(AutotagOption::None)
        .remote_callbacks(fetch_callbacks);
    let cached = Repository::open_bare(repo_path).ok();
    let was_cached = cached.is_some();
    if !was_cached && repo_path.exists() {
        std::fs::remove_dir_all(repo_path).map_err(|_| "Git cache unavailable")?;
    }
    let repo = if let Some(repo) = cached {
        let refspec = format!(
            "+refs/heads/{}:refs/remotes/origin/{}",
            request.branch, request.branch
        );
        repo.find_remote("origin")
            .and_then(|mut remote| remote.fetch(&[&refspec], Some(&mut fetch_options), None))
            .map_err(|error| git_failure("Git fetch failed", error))?;
        repo
    } else {
        let cloned = RepoBuilder::new()
            .bare(true)
            .branch(&request.branch)
            .fetch_options(fetch_options)
            .clone(url, &stage.join("repo"))
            .map_err(|error| git_failure("Git clone failed", error))?;
        drop(cloned);
        std::fs::create_dir_all(repo_path.parent().ok_or("Git cache path unavailable")?)
            .map_err(|_| "Git cache unavailable")?;
        std::fs::rename(stage.join("repo"), repo_path).map_err(|_| "Git cache unavailable")?;
        Repository::open_bare(repo_path).map_err(|_| "Git cache unavailable")?
    };

    let refname = format!("refs/heads/{}", request.branch);
    let parent = find_parent(&repo, &request.branch, was_cached)?;
    if parent.id().to_string() != request.expected_head_oid {
        return Ok(GitPushResponse {
            status: "head-conflict",
            commit_oid: None,
            blob_shas: HashMap::new(),
            failure_reason: None,
        });
    }

    let baseline = parent
        .tree()
        .map_err(|error| git_failure("Git tree unavailable", error))?;
    let mut updates = TreeUpdateBuilder::new();
    let mut blob_shas = HashMap::new();
    for file in &request.additions {
        let blob = repo
            .blob_path(&stage.join(file.index.to_string()))
            .map_err(|error| git_failure("Git blob write failed", error))?;
        updates.upsert(&file.path, blob, FileMode::Blob);
        blob_shas.insert(file.path.clone(), blob.to_string());
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
            blob_shas,
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
        blob_shas,
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
}
