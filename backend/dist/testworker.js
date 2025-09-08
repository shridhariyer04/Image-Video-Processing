"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const image_worker_1 = require("./wokers/image.worker");
async function runTest() {
    const worker = new image_worker_1.ImageWorker();
    const result = await worker.testOperations({
        resize: { width: 300, height: 300 }, // Fixed typo: 'with' → 'width'
    });
    console.log("Final result:", result);
}
runTest().catch(console.error);
