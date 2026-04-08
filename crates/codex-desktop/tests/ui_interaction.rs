use accesskit::{Action, ActionRequest, Node, NodeId, TreeUpdate};

/// Stub AccessKit tester — demonstrates the pattern for UI-tree traversal.
/// The real implementation requires `iced_winit`'s AccessKit adapter which
/// is only available when the application is running with a display.
pub struct AccessibilityTester {
    pub root_id: NodeId,
    pub nodes: std::collections::HashMap<NodeId, Node>,
}

impl AccessibilityTester {
    pub fn new() -> Self {
        Self {
            root_id: NodeId(1),
            nodes: std::collections::HashMap::new(),
        }
    }

    pub fn apply_update(&mut self, update: TreeUpdate) {
        for (id, node) in update.nodes {
            self.nodes.insert(id, node);
        }
    }

    pub fn find_by_label(&self, target_label: &str) -> Option<&Node> {
        self.nodes.values().find(|node| {
            node.value().map(|s| s.contains(target_label)).unwrap_or(false)
        })
    }

    pub fn perform_action(&self, target_node: NodeId, action: Action) {
        let request = ActionRequest {
            action,
            target_tree: accesskit::TreeId::ROOT,
            target_node,
            data: None,
        };
        println!("AccessKit action dispatched: {:?}", request);
    }
}

#[test]
fn example_accesskit_traversal() {
    let mut tester = AccessibilityTester::new();
    let root_node = Node::new(accesskit::Role::Window);
    tester.nodes.insert(tester.root_id, root_node);
    assert_eq!(tester.nodes.len(), 1);
}
