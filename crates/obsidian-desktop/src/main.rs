use iced::widget::{button, column, container, row, scrollable, text, text_input};
use iced::{Element, Length, Task};

use obsidian_client::ObsidianClient;
use obsidian_types::{FileNode, Vault};

fn main() -> iced::Result {
    iced::application("Obsidian Desktop (Iced) Skeleton", update, view)
        .run_with(|| (DesktopApp::default(), Task::none()))
}

#[derive(Debug, Clone)]
enum Message {
    BaseUrlChanged(String),
    UsernameChanged(String),
    PasswordChanged(String),
    LoginPressed,
    LoginFinished(Result<ObsidianClient, String>),

    LoadVaultsPressed,
    VaultsLoaded(Result<Vec<Vault>, String>),
    VaultSelected(String),

    LoadTreePressed,
    TreeLoaded(Result<Vec<FileNode>, String>),

    NotePathChanged(String),
    LoadNotePressed,
    NoteLoaded(Result<(String, String), String>),

    EditorChanged(String),
    SaveNotePressed,
    NoteSaved(Result<String, String>),

    ConnectEventsPressed,
    EventsConnected(Result<String, String>),
}

#[derive(Debug, Default)]
struct DesktopApp {
    base_url: String,
    username: String,
    password: String,
    status: String,

    client: Option<ObsidianClient>,
    vaults: Vec<Vault>,
    selected_vault_id: Option<String>,

    tree_entries: Vec<String>,

    note_path: String,
    note_content: String,
    preview_content: String,
}

fn update(state: &mut DesktopApp, message: Message) -> Task<Message> {
    match message {
        Message::BaseUrlChanged(value) => {
            state.base_url = value;
            Task::none()
        }
        Message::UsernameChanged(value) => {
            state.username = value;
            Task::none()
        }
        Message::PasswordChanged(value) => {
            state.password = value;
            Task::none()
        }
        Message::LoginPressed => {
            let base_url = if state.base_url.trim().is_empty() {
                "http://127.0.0.1:8080".to_string()
            } else {
                state.base_url.trim().to_string()
            };
            let username = state.username.trim().to_string();
            let password = state.password.clone();
            state.status = "Logging in…".to_string();

            Task::perform(
                async move {
                    let mut client = ObsidianClient::new(base_url);
                    client
                        .login(&username, &password)
                        .await
                        .map_err(|e| format!("Login failed: {e}"))?;
                    Ok(client)
                },
                Message::LoginFinished,
            )
        }
        Message::LoginFinished(result) => {
            match result {
                Ok(client) => {
                    state.client = Some(client);
                    state.status = "Login successful".to_string();
                    return Task::done(Message::LoadVaultsPressed);
                }
                Err(err) => {
                    state.status = err;
                }
            }
            Task::none()
        }

        Message::LoadVaultsPressed => {
            let Some(client) = state.client.clone() else {
                state.status = "Please login first".to_string();
                return Task::none();
            };
            state.status = "Loading vaults…".to_string();
            Task::perform(
                async move {
                    client
                        .list_vaults()
                        .await
                        .map_err(|e| format!("Failed to load vaults: {e}"))
                },
                Message::VaultsLoaded,
            )
        }
        Message::VaultsLoaded(result) => {
            match result {
                Ok(vaults) => {
                    state.vaults = vaults;
                    state.status = format!("Loaded {} vault(s)", state.vaults.len());
                    if state.selected_vault_id.is_none() {
                        state.selected_vault_id = state.vaults.first().map(|v| v.id.clone());
                    }
                }
                Err(err) => {
                    state.status = err;
                }
            }
            Task::none()
        }
        Message::VaultSelected(vault_id) => {
            state.selected_vault_id = Some(vault_id);
            Task::done(Message::LoadTreePressed)
        }

        Message::LoadTreePressed => {
            let (Some(client), Some(vault_id)) =
                (state.client.clone(), state.selected_vault_id.clone())
            else {
                state.status = "Select a vault first".to_string();
                return Task::none();
            };
            state.status = "Loading file tree…".to_string();
            Task::perform(
                async move {
                    client
                        .get_file_tree(&vault_id)
                        .await
                        .map_err(|e| format!("Failed to load tree: {e}"))
                },
                Message::TreeLoaded,
            )
        }
        Message::TreeLoaded(result) => {
            match result {
                Ok(tree) => {
                    state.tree_entries = flatten_tree(&tree);
                    state.status = format!("Loaded {} tree entries", state.tree_entries.len());
                }
                Err(err) => {
                    state.status = err;
                }
            }
            Task::none()
        }

        Message::NotePathChanged(value) => {
            state.note_path = value;
            Task::none()
        }
        Message::LoadNotePressed => {
            let (Some(client), Some(vault_id)) =
                (state.client.clone(), state.selected_vault_id.clone())
            else {
                state.status = "Login and select a vault first".to_string();
                return Task::none();
            };

            let note_path = state.note_path.trim().to_string();
            if note_path.is_empty() {
                state.status = "Enter a note path to load".to_string();
                return Task::none();
            }

            state.status = format!("Loading note {note_path}…");
            Task::perform(
                async move {
                    let file = client
                        .read_file(&vault_id, &note_path)
                        .await
                        .map_err(|e| format!("Failed to read note: {e}"))?;
                    Ok((note_path, file.content))
                },
                Message::NoteLoaded,
            )
        }
        Message::NoteLoaded(result) => {
            match result {
                Ok((path, content)) => {
                    state.note_path = path;
                    state.note_content = content.clone();
                    state.preview_content = content;
                    state.status = "Note loaded".to_string();
                }
                Err(err) => {
                    state.status = err;
                }
            }
            Task::none()
        }

        Message::EditorChanged(content) => {
            state.note_content = content.clone();
            state.preview_content = content;
            Task::none()
        }
        Message::SaveNotePressed => {
            let (Some(client), Some(vault_id)) =
                (state.client.clone(), state.selected_vault_id.clone())
            else {
                state.status = "Login and select a vault first".to_string();
                return Task::none();
            };

            let note_path = state.note_path.trim().to_string();
            let content = state.note_content.clone();
            if note_path.is_empty() {
                state.status = "Enter a note path to save".to_string();
                return Task::none();
            }

            state.status = format!("Saving {note_path}…");
            Task::perform(
                async move {
                    let request = obsidian_types::UpdateFileRequest {
                        content,
                        last_modified: None,
                        frontmatter: None,
                    };
                    let saved = client
                        .write_file(&vault_id, &note_path, &request)
                        .await
                        .map_err(|e| format!("Failed to save note: {e}"))?;
                    Ok(saved.modified.to_rfc3339())
                },
                Message::NoteSaved,
            )
        }
        Message::NoteSaved(result) => {
            match result {
                Ok(modified) => {
                    state.status = format!("Note saved at {modified}");
                }
                Err(err) => {
                    state.status = err;
                }
            }
            Task::none()
        }

        Message::ConnectEventsPressed => {
            let Some(client) = state.client.clone() else {
                state.status = "Please login first".to_string();
                return Task::none();
            };

            state.status = "Connecting event sync loop…".to_string();
            Task::perform(
                async move {
                    let _stream = client
                        .connect_ws()
                        .await
                        .map_err(|e| format!("WebSocket connect failed: {e}"))?;
                    Ok("Event sync loop connected (skeleton)".to_string())
                },
                Message::EventsConnected,
            )
        }
        Message::EventsConnected(result) => {
            match result {
                Ok(msg) => state.status = msg,
                Err(err) => state.status = err,
            }
            Task::none()
        }
    }
}

fn view(state: &DesktopApp) -> Element<'_, Message> {
    let auth_controls = row![
        text_input("Base URL", &state.base_url)
            .on_input(Message::BaseUrlChanged)
            .width(Length::FillPortion(2)),
        text_input("Username", &state.username)
            .on_input(Message::UsernameChanged)
            .width(Length::FillPortion(1)),
        text_input("Password", &state.password)
            .on_input(Message::PasswordChanged)
            .width(Length::FillPortion(1)),
        button("Login").on_press(Message::LoginPressed),
        button("WS Sync").on_press(Message::ConnectEventsPressed),
    ]
    .spacing(8);

    let vault_buttons = state
        .vaults
        .iter()
        .fold(column![text("Vaults")].spacing(6), |col, vault| {
            let label = if state.selected_vault_id.as_deref() == Some(vault.id.as_str()) {
                format!("• {}", vault.name)
            } else {
                vault.name.clone()
            };
            col.push(button(text(label)).on_press(Message::VaultSelected(vault.id.clone())))
        })
        .push(button("Refresh Vaults").on_press(Message::LoadVaultsPressed))
        .push(button("Refresh Tree").on_press(Message::LoadTreePressed));

    let tree_panel = scrollable(
        state
            .tree_entries
            .iter()
            .fold(column![text("Vault Tree")].spacing(4), |col, path| {
                col.push(text(path))
            }),
    )
    .height(Length::Fill);

    let note_controls = row![
        text_input("path/to/note.md", &state.note_path)
            .on_input(Message::NotePathChanged)
            .width(Length::Fill),
        button("Open").on_press(Message::LoadNotePressed),
        button("Save").on_press(Message::SaveNotePressed),
    ]
    .spacing(8);

    let editor = text_input("Note content", &state.note_content)
        .on_input(Message::EditorChanged)
        .width(Length::Fill)
        .padding(10)
        .size(14);

    let preview = scrollable(container(text(state.preview_content.as_str()).size(14)).padding(10))
        .height(Length::Fill);

    let body = row![
        container(column![vault_buttons, tree_panel].spacing(10))
            .width(Length::FillPortion(1))
            .padding(8),
        container(column![note_controls, editor, text("Preview"), preview].spacing(8))
            .width(Length::FillPortion(3))
            .padding(8),
    ]
    .spacing(10)
    .height(Length::Fill);

    container(
        column![auth_controls, text(state.status.as_str()), body]
            .spacing(10)
            .padding(10),
    )
    .width(Length::Fill)
    .height(Length::Fill)
    .into()
}

fn flatten_tree(nodes: &[FileNode]) -> Vec<String> {
    fn walk(node: &FileNode, depth: usize, out: &mut Vec<String>) {
        let prefix = "  ".repeat(depth);
        let marker = if node.is_directory { "📁" } else { "📄" };
        out.push(format!("{prefix}{marker} {}", node.path));

        if let Some(children) = &node.children {
            for child in children {
                walk(child, depth + 1, out);
            }
        }
    }

    let mut out = Vec::new();
    for node in nodes {
        walk(node, 0, &mut out);
    }
    out
}
