/**
 * Offline Module
 *
 * Handles message queuing and smart degradation when all user devices
 * are offline (sleeping, in court, watching movies, etc.).
 */

// Offline message queue
export {
  dequeueMessages,
  enqueueMessage,
  formatQueueStatus,
  getQueueStatus,
  markDelivered,
  purgeOldMessages,
} from "./offline-queue.js";

// Smart degradation
export {
  formatOfflineNotification,
  handleConversationWithDegradation,
  hasOnlineDevices,
  processQueuedMessages,
} from "./smart-degradation.js";

// Re-export types
export type { QueuedMessage, ResponseStrategy, ResponseTier } from "../relay/types.js";
