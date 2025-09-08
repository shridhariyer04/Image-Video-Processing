// loggerTest.ts
import logger from "./src/utils/logger";

logger.info("App started");

// simulate job failure
const jobId = "123";
const failedReason = "Invalid image format";
const attemptsMade = 2;
const maxAttempts = 3;

logger.error("Job failed", {
  jobId,
  failedReason,
  attemptsMade,
  maxAttempts,
});
