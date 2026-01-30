// Parsing functions and types
export {
  // Constants
  SUBTASKS_HEADER,
  TASKS_HEADER,
  // Encoding utilities
  encodeMetadataValue,
  decodeMetadataValue,
  // Types
  type ParsedRootTaskMetadata,
  type EmbeddedSubtask,
  type HierarchicalTask,
  type ParsedIssueBody,
  type ParsedSubtaskId,
  type ParsedHierarchicalIssueBody,
  // Parsing functions
  parseRootTaskMetadata,
  parseSubtaskId,
  parseIssueBody,
  parseHierarchicalIssueBody,
  // Conversion utilities
  embeddedSubtaskToTask,
  taskToEmbeddedSubtask,
  getNextSubtaskIndex,
  collectDescendants,
} from "./issue-parsing.js";

// Rendering functions
export {
  createSubtaskId,
  renderIssueBody,
  renderHierarchicalIssueBody,
  renderTaskMetadataComments,
  type TaskLike,
} from "./issue-rendering.js";
