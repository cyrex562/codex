use crate::config::StorageConfig;
use crate::error::{AppError, AppResult};
use crate::models::{FileContent, FileNode};
use crate::services::file_service::RenameStrategy;
use crate::services::FileService;
use chrono::{DateTime, Utc};
use std::fs::OpenOptions;
use std::io::Write;
use std::path::Path;
use std::sync::Arc;

pub trait StorageBackend: Send + Sync {
    fn backend_name(&self) -> &'static str;
    fn read_raw(&self, vault_path: &str, file_path: &str) -> AppResult<Vec<u8>>;
    fn create_file(
        &self,
        vault_path: &str,
        file_path: &str,
        content: Option<&str>,
    ) -> AppResult<FileContent>;
    fn write_file(
        &self,
        vault_path: &str,
        file_path: &str,
        content: &str,
        last_modified: Option<DateTime<Utc>>,
        frontmatter: Option<&serde_json::Value>,
    ) -> AppResult<FileContent>;
    fn create_upload_session_temp(&self, vault_path: &str, session_id: &str) -> AppResult<()>;
    fn append_upload_chunk(
        &self,
        vault_path: &str,
        session_id: &str,
        bytes: &[u8],
    ) -> AppResult<u64>;
    fn get_upload_session_size(&self, vault_path: &str, session_id: &str) -> AppResult<u64>;
    fn finalize_upload_session(
        &self,
        vault_path: &str,
        session_id: &str,
        target_dir: &str,
        filename: &str,
    ) -> AppResult<String>;
    fn delete_upload_session_temp(&self, vault_path: &str, session_id: &str) -> AppResult<()>;

    fn get_file_tree(&self, vault_path: &str) -> AppResult<Vec<FileNode>>;
    fn read_file(&self, vault_path: &str, file_path: &str) -> AppResult<FileContent>;
    fn delete_file(&self, vault_path: &str, file_path: &str) -> AppResult<()>;
    fn rename_file(
        &self,
        vault_path: &str,
        from: &str,
        to: &str,
        strategy: RenameStrategy,
    ) -> AppResult<String>;
    fn create_directory(&self, vault_path: &str, dir_path: &str) -> AppResult<()>;
    fn list_markdown_files(&self, vault_path: &str) -> AppResult<Vec<(String, String)>>;
}

#[derive(Default)]
pub struct LocalFsStorageBackend;

impl StorageBackend for LocalFsStorageBackend {
    fn backend_name(&self) -> &'static str {
        "local"
    }

    fn read_raw(&self, vault_path: &str, file_path: &str) -> AppResult<Vec<u8>> {
        FileService::read_raw_file(vault_path, file_path)
    }

    fn create_file(
        &self,
        vault_path: &str,
        file_path: &str,
        content: Option<&str>,
    ) -> AppResult<FileContent> {
        FileService::create_file(vault_path, file_path, content)
    }

    fn write_file(
        &self,
        vault_path: &str,
        file_path: &str,
        content: &str,
        last_modified: Option<DateTime<Utc>>,
        frontmatter: Option<&serde_json::Value>,
    ) -> AppResult<FileContent> {
        FileService::write_file(vault_path, file_path, content, last_modified, frontmatter)
    }

    fn create_upload_session_temp(&self, vault_path: &str, session_id: &str) -> AppResult<()> {
        let upload_dir = Path::new(vault_path).join(".obsidian").join("uploads");
        std::fs::create_dir_all(&upload_dir)?;
        let temp_file_path = upload_dir.join(session_id);
        std::fs::File::create(temp_file_path)?;
        Ok(())
    }

    fn append_upload_chunk(
        &self,
        vault_path: &str,
        session_id: &str,
        bytes: &[u8],
    ) -> AppResult<u64> {
        let temp_file_path = upload_temp_file_path(vault_path, session_id);
        if !temp_file_path.exists() {
            return Err(AppError::NotFound("Upload session not found".to_string()));
        }

        let mut file = OpenOptions::new().append(true).open(&temp_file_path)?;
        file.write_all(bytes)?;
        Ok(file.metadata()?.len())
    }

    fn get_upload_session_size(&self, vault_path: &str, session_id: &str) -> AppResult<u64> {
        let temp_file_path = upload_temp_file_path(vault_path, session_id);
        if !temp_file_path.exists() {
            return Err(AppError::NotFound("Upload session not found".to_string()));
        }
        Ok(std::fs::metadata(temp_file_path)?.len())
    }

    fn finalize_upload_session(
        &self,
        vault_path: &str,
        session_id: &str,
        target_dir: &str,
        filename: &str,
    ) -> AppResult<String> {
        validate_upload_filename(filename)?;

        let temp_file_path = upload_temp_file_path(vault_path, session_id);
        if !temp_file_path.exists() {
            return Err(AppError::NotFound("Upload session not found".to_string()));
        }

        let safe_target_dir = if target_dir.is_empty() {
            Path::new(vault_path).to_path_buf()
        } else {
            FileService::resolve_path(vault_path, target_dir)?
        };

        if !safe_target_dir.exists() {
            std::fs::create_dir_all(&safe_target_dir)?;
        } else if !safe_target_dir.is_dir() {
            return Err(AppError::InvalidInput(
                "Target path is not a directory".to_string(),
            ));
        }

        let final_path = safe_target_dir.join(filename);
        if let Some(parent) = final_path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        if let Err(_) = std::fs::rename(&temp_file_path, &final_path) {
            std::fs::copy(&temp_file_path, &final_path)?;
            std::fs::remove_file(&temp_file_path)?;
        }

        let relative = final_path
            .strip_prefix(vault_path)
            .unwrap_or(&final_path)
            .to_string_lossy()
            .to_string();

        Ok(relative)
    }

    fn delete_upload_session_temp(&self, vault_path: &str, session_id: &str) -> AppResult<()> {
        let temp_file_path = upload_temp_file_path(vault_path, session_id);
        if temp_file_path.exists() {
            std::fs::remove_file(temp_file_path)?;
        }
        Ok(())
    }

    fn get_file_tree(&self, vault_path: &str) -> AppResult<Vec<FileNode>> {
        FileService::get_file_tree(vault_path)
    }

    fn read_file(&self, vault_path: &str, file_path: &str) -> AppResult<FileContent> {
        FileService::read_file(vault_path, file_path)
    }

    fn delete_file(&self, vault_path: &str, file_path: &str) -> AppResult<()> {
        FileService::delete_file(vault_path, file_path)
    }

    fn rename_file(
        &self,
        vault_path: &str,
        from: &str,
        to: &str,
        strategy: RenameStrategy,
    ) -> AppResult<String> {
        FileService::rename(vault_path, from, to, strategy)
    }

    fn create_directory(&self, vault_path: &str, dir_path: &str) -> AppResult<()> {
        FileService::create_directory(vault_path, dir_path)
    }

    fn list_markdown_files(&self, vault_path: &str) -> AppResult<Vec<(String, String)>> {
        use walkdir::WalkDir;
        let mut files = Vec::new();
        for entry in WalkDir::new(vault_path)
            .follow_links(false)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            let path = entry.path();
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                if name.starts_with('.') {
                    continue;
                }
            }
            if path.is_file() {
                if path.extension().and_then(|e| e.to_str()) == Some("md") {
                    if let Ok(content) = std::fs::read_to_string(path) {
                        let rel = path
                            .strip_prefix(vault_path)
                            .unwrap_or(path)
                            .to_string_lossy()
                            .to_string();
                        files.push((rel, content));
                    }
                }
            }
        }
        Ok(files)
    }
}

pub struct S3StorageBackend {
    store: Arc<dyn object_store::ObjectStore>,
    handle: tokio::runtime::Handle,
    _rt_thread: std::thread::JoinHandle<()>,
    temp_dir: std::path::PathBuf,
}

impl S3StorageBackend {
    pub fn from_config(config: &crate::config::S3StorageConfig) -> AppResult<Self> {
        let bucket = config
            .bucket
            .clone()
            .ok_or_else(|| AppError::InternalError("S3 bucket not configured".to_string()))?;

        let mut builder = object_store::aws::AmazonS3Builder::new().with_bucket_name(&bucket);

        if let Some(ref endpoint) = config.endpoint {
            builder = builder.with_endpoint(endpoint);
        }
        if let Some(ref region) = config.region {
            builder = builder.with_region(region);
        }
        if let Some(ref access_key) = config.access_key {
            builder = builder.with_access_key_id(access_key);
        }
        if let Some(ref secret_key) = config.secret_key {
            builder = builder.with_secret_access_key(secret_key);
        }
        if config.path_style {
            builder = builder.with_virtual_hosted_style_request(false);
        }
        // Allow plain HTTP endpoints (SeaweedFS, MinIO, local dev, etc.).
        // object_store rejects http:// URLs by default unless this flag is set.
        if config.endpoint.as_deref().map(|e| e.starts_with("http://")).unwrap_or(false) {
            builder = builder.with_allow_http(true);
        }

        let store = builder
            .build()
            .map_err(|e| AppError::InternalError(format!("Failed to build S3 client: {e}")))?;

        let (handle_tx, handle_rx) = std::sync::mpsc::channel::<tokio::runtime::Handle>();
        let rt_thread = std::thread::Builder::new()
            .name("s3-runtime".to_string())
            .spawn(move || {
                let rt = tokio::runtime::Builder::new_multi_thread()
                    .worker_threads(2)
                    .enable_all()
                    .build()
                    .expect("Failed to create S3 Tokio runtime");
                handle_tx.send(rt.handle().clone()).ok();
                rt.block_on(std::future::pending::<()>());
            })
            .map_err(|e| AppError::InternalError(format!("Failed to spawn S3 runtime thread: {e}")))?;

        let handle = handle_rx
            .recv()
            .map_err(|_| AppError::InternalError("S3 runtime handle channel failed".to_string()))?;

        let temp_dir = std::env::temp_dir().join("obsidian-host-uploads");
        std::fs::create_dir_all(&temp_dir)
            .map_err(|e| AppError::InternalError(format!("Failed to create S3 temp dir: {e}")))?;

        Ok(Self {
            store: Arc::new(store),
            handle,
            _rt_thread: rt_thread,
            temp_dir,
        })
    }

    fn obj_key(vault_path: &str, file_path: &str) -> object_store::path::Path {
        let base = vault_path
            .trim_start_matches('/')
            .trim_end_matches('/');
        let file = file_path.trim_start_matches('/');
        if file.is_empty() {
            object_store::path::Path::from(base)
        } else {
            object_store::path::Path::from(format!("{base}/{file}").as_str())
        }
    }

    fn vault_prefix(vault_path: &str) -> object_store::path::Path {
        object_store::path::Path::from(
            vault_path
                .trim_start_matches('/')
                .trim_end_matches('/'),
        )
    }

    fn run<F, T>(&self, fut: F) -> AppResult<T>
    where
        F: std::future::Future<Output = Result<T, object_store::Error>> + Send + 'static,
        T: Send + 'static,
    {
        let (tx, rx) = std::sync::mpsc::channel();
        self.handle.spawn(async move {
            tx.send(fut.await).ok();
        });
        rx.recv()
            .map_err(|_| AppError::InternalError("S3 channel recv failed".to_string()))?
            .map_err(|e| AppError::InternalError(format!("S3 error: {e}")))
    }

    fn run_app<F, T>(&self, fut: F) -> AppResult<T>
    where
        F: std::future::Future<Output = AppResult<T>> + Send + 'static,
        T: Send + 'static,
    {
        let (tx, rx) = std::sync::mpsc::channel::<AppResult<T>>();
        self.handle.spawn(async move {
            tx.send(fut.await).ok();
        });
        rx.recv()
            .map_err(|_| AppError::InternalError("S3 channel recv failed".to_string()))?
    }

    fn upload_temp_path(&self, session_id: &str) -> std::path::PathBuf {
        self.temp_dir.join(session_id)
    }

    fn parse_frontmatter(text: &str) -> (String, Option<serde_json::Value>) {
        if text.starts_with("---\n") || text.starts_with("---\r\n") {
            let after = if text.starts_with("---\r\n") {
                &text[5..]
            } else {
                &text[4..]
            };
            if let Some(end) = after.find("\n---\n").or_else(|| after.find("\n---\r\n")) {
                let yaml_str = &after[..end];
                let content_start = end
                    + if after[end..].starts_with("\n---\r\n") {
                        6
                    } else {
                        5
                    };
                let body = after[content_start..].to_string();
                if let Ok(val) = serde_yaml::from_str::<serde_json::Value>(yaml_str) {
                    return (body, Some(val));
                }
            }
        }
        (text.to_string(), None)
    }
}

impl StorageBackend for S3StorageBackend {
    fn backend_name(&self) -> &'static str {
        "s3"
    }

    fn read_raw(&self, vault_path: &str, file_path: &str) -> AppResult<Vec<u8>> {
        let store = self.store.clone();
        let key = Self::obj_key(vault_path, file_path);
        self.run(async move {
            let resp = store.get(&key).await?;
            let bytes = resp.bytes().await?;
            Ok(bytes.to_vec())
        })
    }

    fn create_file(
        &self,
        vault_path: &str,
        file_path: &str,
        content: Option<&str>,
    ) -> AppResult<FileContent> {
        let body = content.unwrap_or("").to_string();
        self.write_file(vault_path, file_path, &body, None, None)
    }

    fn write_file(
        &self,
        vault_path: &str,
        file_path: &str,
        content: &str,
        _last_modified: Option<DateTime<Utc>>,
        frontmatter: Option<&serde_json::Value>,
    ) -> AppResult<FileContent> {
        let store = self.store.clone();
        let key = Self::obj_key(vault_path, file_path);
        let path_str = file_path.to_string();

        let final_content = if let Some(fm) = frontmatter {
            match serde_yaml::to_string(fm) {
                Ok(yaml) => format!("---\n{yaml}---\n{content}"),
                Err(_) => content.to_string(),
            }
        } else {
            content.to_string()
        };

        let bytes = bytes::Bytes::from(final_content.into_bytes());
        let key2 = key.clone();

        self.run(async move {
            store.put(&key2, bytes.into()).await?;
            Ok(())
        })?;

        let store2 = self.store.clone();
        let meta = self.run(async move { store2.head(&key).await })?;
        let modified = meta.last_modified;

        Ok(FileContent {
            path: path_str,
            content: content.to_string(),
            modified,
            frontmatter: frontmatter.cloned(),
        })
    }

    fn create_upload_session_temp(&self, _vault_path: &str, session_id: &str) -> AppResult<()> {
        let path = self.upload_temp_path(session_id);
        std::fs::File::create(path)
            .map_err(|e| AppError::InternalError(format!("Failed to create upload temp: {e}")))?;
        Ok(())
    }

    fn append_upload_chunk(
        &self,
        _vault_path: &str,
        session_id: &str,
        chunk_bytes: &[u8],
    ) -> AppResult<u64> {
        let path = self.upload_temp_path(session_id);
        if !path.exists() {
            return Err(AppError::NotFound("Upload session not found".to_string()));
        }
        let mut file = OpenOptions::new().append(true).open(&path)?;
        file.write_all(chunk_bytes)?;
        Ok(file.metadata()?.len())
    }

    fn get_upload_session_size(&self, _vault_path: &str, session_id: &str) -> AppResult<u64> {
        let path = self.upload_temp_path(session_id);
        if !path.exists() {
            return Err(AppError::NotFound("Upload session not found".to_string()));
        }
        Ok(std::fs::metadata(path)?.len())
    }

    fn finalize_upload_session(
        &self,
        vault_path: &str,
        session_id: &str,
        target_dir: &str,
        filename: &str,
    ) -> AppResult<String> {
        validate_upload_filename(filename)?;

        let temp_path = self.upload_temp_path(session_id);
        if !temp_path.exists() {
            return Err(AppError::NotFound("Upload session not found".to_string()));
        }

        let file_data = std::fs::read(&temp_path)
            .map_err(|e| AppError::InternalError(format!("Failed to read upload temp: {e}")))?;
        let _ = std::fs::remove_file(&temp_path);

        let s3_path = if target_dir.is_empty() {
            filename.to_string()
        } else {
            format!(
                "{}/{}",
                target_dir.trim_end_matches('/'),
                filename
            )
        };

        let store = self.store.clone();
        let key = Self::obj_key(vault_path, &s3_path);
        let bytes = bytes::Bytes::from(file_data);
        self.run(async move {
            store.put(&key, bytes.into()).await?;
            Ok(())
        })?;

        Ok(s3_path)
    }

    fn delete_upload_session_temp(&self, _vault_path: &str, session_id: &str) -> AppResult<()> {
        let path = self.upload_temp_path(session_id);
        if path.exists() {
            std::fs::remove_file(path)?;
        }
        Ok(())
    }

    fn get_file_tree(&self, vault_path: &str) -> AppResult<Vec<FileNode>> {
        use futures::StreamExt;
        let store = self.store.clone();
        let prefix = Self::vault_prefix(vault_path);
        let prefix_str = prefix.to_string();

        let metas: Vec<object_store::ObjectMeta> = self.run_app(async move {
            let mut stream = store.list(Some(&prefix));
            let mut results = Vec::new();
            while let Some(item) = stream.next().await {
                let meta = item.map_err(|e| AppError::InternalError(format!("S3 list error: {e}")))?;
                results.push(meta);
            }
            Ok(results)
        })?;

        build_file_nodes_from_metas(&metas, &prefix_str, vault_path)
    }

    fn read_file(&self, vault_path: &str, file_path: &str) -> AppResult<FileContent> {
        let bytes = self.read_raw(vault_path, file_path)?;
        let text = String::from_utf8_lossy(&bytes).to_string();
        let (body, fm) = Self::parse_frontmatter(&text);

        let store = self.store.clone();
        let key = Self::obj_key(vault_path, file_path);
        let meta = self.run(async move { store.head(&key).await })?;

        Ok(FileContent {
            path: file_path.to_string(),
            content: body,
            modified: meta.last_modified,
            frontmatter: fm,
        })
    }

    fn delete_file(&self, vault_path: &str, file_path: &str) -> AppResult<()> {
        let store = self.store.clone();
        let key = Self::obj_key(vault_path, file_path);
        let filename = std::path::Path::new(file_path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(file_path);
        let timestamp = chrono::Utc::now().timestamp_millis();
        let trash_path = format!(".trash/{}_{}", timestamp, filename);
        let trash_key = Self::obj_key(vault_path, &trash_path);
        let src_key_copy = key.clone();

        let store2 = self.store.clone();
        if let Err(_) = self.run(async move {
            store2
                .copy(&src_key_copy, &trash_key)
                .await
                .map_err(|e| e)
        }) {
            // copy failed - just delete
        }

        self.run(async move {
            store.delete(&key).await?;
            Ok(())
        })
    }

    fn rename_file(
        &self,
        vault_path: &str,
        from: &str,
        to: &str,
        strategy: RenameStrategy,
    ) -> AppResult<String> {
        let dest = resolve_s3_rename_dest(self, vault_path, from, to, strategy)?;
        let src_key = Self::obj_key(vault_path, from);
        let dst_key = Self::obj_key(vault_path, &dest);

        let src_str = src_key.to_string();
        let dst_str = dst_key.to_string();

        // Check if source is a "directory" (has objects with this prefix)
        let check_store = self.store.clone();
        let src_prefix = src_key.clone();
        let is_dir = self.run_app(async move {
            use futures::StreamExt;
            let mut stream = check_store.list(Some(&src_prefix));
            let first = stream.next().await;
            Ok::<bool, AppError>(first.is_some())
        })?;

        // Check if src itself is a file (direct object)
        let head_store = self.store.clone();
        let src_head_key = src_key.clone();
        let is_file = self
            .run(async move { head_store.head(&src_head_key).await })
            .is_ok();

        if is_file {
            let s = self.store.clone();
            let sk = Self::obj_key(vault_path, from);
            let dk = Self::obj_key(vault_path, &dest);
            self.run(async move {
                s.copy(&sk, &dk).await?;
                Ok(())
            })?;
            let s2 = self.store.clone();
            let sk2 = Self::obj_key(vault_path, from);
            self.run(async move {
                s2.delete(&sk2).await?;
                Ok(())
            })?;
        } else if is_dir {
            use futures::StreamExt;
            let list_store = self.store.clone();
            let src_p = object_store::path::Path::from(src_str.as_str());
            let objects: Vec<object_store::ObjectMeta> = self.run_app(async move {
                let mut stream = list_store.list(Some(&src_p));
                let mut v = Vec::new();
                while let Some(item) = stream.next().await {
                    v.push(item.map_err(|e| AppError::InternalError(format!("S3 list: {e}")))?);
                }
                Ok(v)
            })?;
            for obj in &objects {
                let rel = obj
                    .location
                    .as_ref()
                    .strip_prefix(src_str.as_str())
                    .unwrap_or(obj.location.as_ref());
                let new_key_str = format!("{}/{}", dst_str, rel.trim_start_matches('/'));
                let new_key =
                    object_store::path::Path::from(new_key_str.as_str());
                let s = self.store.clone();
                let src_k = obj.location.clone();
                let dst_k = new_key.clone();
                self.run(async move {
                    s.copy(&src_k, &dst_k).await?;
                    Ok(())
                })?;
            }
            for obj in &objects {
                let s = self.store.clone();
                let k = obj.location.clone();
                self.run(async move {
                    s.delete(&k).await?;
                    Ok(())
                })?;
            }
        } else {
            return Err(AppError::NotFound(format!("Path not found: {from}")));
        }

        Ok(dest)
    }

    fn create_directory(&self, vault_path: &str, dir_path: &str) -> AppResult<()> {
        let store = self.store.clone();
        let keep_path = format!("{dir_path}/.keep");
        let key = Self::obj_key(vault_path, &keep_path);
        self.run(async move {
            store
                .put(&key, bytes::Bytes::new().into())
                .await?;
            Ok(())
        })
    }

    fn list_markdown_files(&self, vault_path: &str) -> AppResult<Vec<(String, String)>> {
        use futures::StreamExt;
        let store = self.store.clone();
        let prefix = Self::vault_prefix(vault_path);
        let prefix_str = prefix.to_string();

        let metas: Vec<object_store::ObjectMeta> = self.run_app(async move {
            let mut stream = store.list(Some(&prefix));
            let mut results = Vec::new();
            while let Some(item) = stream.next().await {
                let meta =
                    item.map_err(|e| AppError::InternalError(format!("S3 list error: {e}")))?;
                results.push(meta);
            }
            Ok(results)
        })?;

        let md_metas: Vec<_> = metas
            .into_iter()
            .filter(|m| m.location.as_ref().ends_with(".md"))
            .collect();

        let mut files = Vec::new();
        for meta in md_metas {
            let loc = meta.location.to_string();
            let rel = loc
                .strip_prefix(&prefix_str)
                .unwrap_or(&loc)
                .trim_start_matches('/')
                .to_string();

            if let Ok(bytes) = self.read_raw(vault_path, &rel) {
                if let Ok(text) = String::from_utf8(bytes) {
                    files.push((rel, text));
                }
            }
        }
        Ok(files)
    }
}

fn resolve_s3_rename_dest(
    backend: &S3StorageBackend,
    vault_path: &str,
    _from: &str,
    to: &str,
    strategy: RenameStrategy,
) -> AppResult<String> {
    match strategy {
        RenameStrategy::Fail | RenameStrategy::Overwrite => Ok(to.to_string()),
        RenameStrategy::AutoRename => {
            use futures::StreamExt;
            let store = backend.store.clone();
            let prefix = S3StorageBackend::vault_prefix(vault_path);
            let prefix_str = prefix.to_string();
            let existing: std::collections::HashSet<String> = backend.run_app(async move {
                let mut stream = store.list(Some(&prefix));
                let mut set = std::collections::HashSet::new();
                while let Some(item) = stream.next().await {
                    if let Ok(meta) = item {
                        let loc = meta.location.to_string();
                        let rel = loc
                            .strip_prefix(&prefix_str)
                            .unwrap_or(&loc)
                            .trim_start_matches('/')
                            .to_string();
                        set.insert(rel);
                    }
                }
                Ok(set)
            })?;

            if !existing.contains(to) {
                return Ok(to.to_string());
            }

            let path = std::path::Path::new(to);
            let stem = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or(to);
            let ext = path.extension().and_then(|e| e.to_str());
            let parent = path.parent().and_then(|p| p.to_str()).unwrap_or("");

            for n in 1..=100 {
                let candidate = if let Some(e) = ext {
                    if parent.is_empty() {
                        format!("{stem} ({n}).{e}")
                    } else {
                        format!("{parent}/{stem} ({n}).{e}")
                    }
                } else if parent.is_empty() {
                    format!("{stem} ({n})")
                } else {
                    format!("{parent}/{stem} ({n})")
                };
                if !existing.contains(&candidate) {
                    return Ok(candidate);
                }
            }
            Err(AppError::InvalidInput(
                "Cannot find unique name after 100 attempts".to_string(),
            ))
        }
    }
}

fn build_file_nodes_from_metas(
    metas: &[object_store::ObjectMeta],
    prefix: &str,
    vault_path: &str,
) -> AppResult<Vec<FileNode>> {
    use std::collections::HashMap;

    let prefix_slash = if prefix.ends_with('/') {
        prefix.to_string()
    } else {
        format!("{prefix}/")
    };

    // Collect relative paths, skipping hidden prefixes and .keep marker files
    let entries: Vec<(String, &object_store::ObjectMeta)> = metas
        .iter()
        .filter_map(|m| {
            let loc = m.location.to_string();
            let rel = loc
                .strip_prefix(&prefix_slash)
                .or_else(|| loc.strip_prefix(prefix))
                .unwrap_or(&loc)
                .trim_start_matches('/')
                .to_string();
            if rel.is_empty() {
                return None;
            }
            // Skip hidden dirs and trash
            let first_segment = rel.split('/').next().unwrap_or("");
            if first_segment.starts_with('.') {
                return None;
            }
            // Skip .keep marker files
            if rel.ends_with("/.keep") || rel == ".keep" {
                return None;
            }
            Some((rel, m))
        })
        .collect();

    // Build tree using a map of dir_path -> children
    // We use a recursive approach: insert into a nested structure
    struct DirBuilder {
        files: Vec<FileNode>,
        dirs: HashMap<String, DirBuilder>,
    }

    impl DirBuilder {
        fn new() -> Self {
            Self {
                files: Vec::new(),
                dirs: HashMap::new(),
            }
        }

        fn insert(&mut self, parts: &[&str], meta: &object_store::ObjectMeta, full_rel: &str) {
            if parts.len() == 1 {
                self.files.push(FileNode {
                    name: parts[0].to_string(),
                    path: full_rel.to_string(),
                    is_directory: false,
                    children: None,
                    size: Some(meta.size as u64),
                    modified: Some(meta.last_modified),
                });
            } else {
                let dir_name = parts[0];
                self.dirs
                    .entry(dir_name.to_string())
                    .or_insert_with(DirBuilder::new)
                    .insert(&parts[1..], meta, full_rel);
            }
        }

        fn build(self, vault_path: &str, path_so_far: &str) -> Vec<FileNode> {
            let mut nodes: Vec<FileNode> = self.files;

            for (dir_name, sub) in self.dirs {
                let dir_path = if path_so_far.is_empty() {
                    dir_name.clone()
                } else {
                    format!("{path_so_far}/{dir_name}")
                };
                let children = sub.build(vault_path, &dir_path);
                nodes.push(FileNode {
                    name: dir_name,
                    path: dir_path,
                    is_directory: true,
                    children: Some(children),
                    size: None,
                    modified: None,
                });
            }

            nodes.sort_by(|a, b| {
                match (a.is_directory, b.is_directory) {
                    (true, false) => std::cmp::Ordering::Less,
                    (false, true) => std::cmp::Ordering::Greater,
                    _ => a.name.cmp(&b.name),
                }
            });
            nodes
        }
    }

    let mut root = DirBuilder::new();
    for (rel, meta) in &entries {
        let parts: Vec<&str> = rel.split('/').collect();
        root.insert(&parts, meta, rel);
    }

    Ok(root.build(vault_path, ""))
}

fn upload_temp_file_path(vault_path: &str, session_id: &str) -> std::path::PathBuf {
    Path::new(vault_path)
        .join(".obsidian")
        .join("uploads")
        .join(session_id)
}

fn validate_upload_filename(filename: &str) -> AppResult<()> {
    let file_name_path = Path::new(filename);
    let mut components = file_name_path.components();
    match (components.next(), components.next()) {
        (Some(std::path::Component::Normal(_)), None) => Ok(()),
        _ => Err(AppError::InvalidInput(
            "Invalid upload filename".to_string(),
        )),
    }
}

pub fn build_storage_backend(config: &StorageConfig) -> AppResult<Arc<dyn StorageBackend>> {
    match config.backend.trim().to_ascii_lowercase().as_str() {
        "s3" => {
            let backend = S3StorageBackend::from_config(&config.s3)?;
            Ok(Arc::new(backend))
        }
        _ => Ok(Arc::new(LocalFsStorageBackend)),
    }
}

pub fn default_storage_backend() -> Arc<dyn StorageBackend> {
    Arc::new(LocalFsStorageBackend)
}
