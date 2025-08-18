import { ImageWorker } from "./wokers/image.worker";

async function runTest() {
  const worker = new ImageWorker();
  const result = await worker.testOperations({
    resize: { width: 300, height: 300 }, // Fixed typo: 'with' → 'width'
  });
  console.log("Final result:", result);
}

runTest().catch(console.error);