// comprehensive-diagnostic.ts
import { imageQueue } from './src/config/bullmq';
import { redis } from './src/config/redis';
import { imageWorker } from './src/wokers/image.worker';
import fs from 'fs/promises';
import path from 'path';

interface FileAnalysis {
  exists: boolean;
  size?: number;
  extension?: string;
  isImage?: boolean;
  readableBySharp?: boolean;
  error?: string;
}

interface JobAnalysis {
  id: string;
  status: string;
  inputFile: string;
  originalName: string;
  operations: any;
  createdAt: Date;
  processedAt?: Date;
  failedReason?: string;
  fileAnalysis: FileAnalysis;
}

async function analyzeFile(filePath: string): Promise<FileAnalysis> {
  const analysis: FileAnalysis = { exists: false };
  
  try {
    const stats = await fs.stat(filePath);
    analysis.exists = true;
    analysis.size = stats.size;
    analysis.extension = path.extname(filePath).toLowerCase();
    
    // Check if it's a supported image format
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.tiff', '.gif', '.bmp'];
    analysis.isImage = imageExtensions.includes(analysis.extension);
    
    if (analysis.isImage) {
      // Try to read with Sharp (basic test)
      try {
        const sharp = require('sharp');
        const image = sharp(filePath);
        const metadata = await image.metadata();
        analysis.readableBySharp = !!(metadata.width && metadata.height);
      } catch (sharpError: any) {
        analysis.readableBySharp = false;
        analysis.error = `Sharp error: ${sharpError.message}`;
      }
    }
  } catch (fsError: any) {
    if (fsError.code === 'ENOENT') {
      analysis.error = 'File not found';
    } else {
      analysis.error = `File system error: ${fsError.message}`;
    }
  }
  
  return analysis;
}

async function comprehensiveDiagnostic() {
  console.log('🔍 COMPREHENSIVE IMAGE PROCESSING DIAGNOSTIC');
  console.log('==============================================\n');
  
  try {
    // 1. Analyze ALL jobs (completed, failed, active, waiting)
    console.log('1. 📊 ANALYZING ALL JOBS...\n');
    
    const jobTypes = ['completed', 'failed', 'active', 'waiting'] as const;
    const allJobAnalyses: JobAnalysis[] = [];
    
    for (const jobType of jobTypes) {
      console.log(`\n📋 ${jobType.toUpperCase()} JOBS:`);
      
      let jobs: any[] = [];
      switch (jobType) {
        case 'completed':
          jobs = await imageQueue.getCompleted();
          break;
        case 'failed':
          jobs = await imageQueue.getFailed();
          break;
        case 'active':
          jobs = await imageQueue.getActive();
          break;
        case 'waiting':
          jobs = await imageQueue.getWaiting();
          break;
      }
      
      console.log(`   Found ${jobs.length} ${jobType} jobs`);
      
      // Analyze each job
      for (let i = 0; i < Math.min(jobs.length, 5); i++) { // Limit to 5 per type for readability
        const job = jobs[i];
        const analysis: JobAnalysis = {
          id: job.id || 'unknown',
          status: jobType,
          inputFile: job.data?.filePath || 'unknown',
          originalName: job.data?.originalName || 'unknown',
          operations: job.data?.operations || {},
          createdAt: new Date(job.timestamp || 0),
          processedAt: job.processedOn ? new Date(job.processedOn) : undefined,
          failedReason: job.failedReason,
          fileAnalysis: await analyzeFile(job.data?.filePath || '')
        };
        
        allJobAnalyses.push(analysis);
        
        console.log(`\n   📄 Job ${i + 1}: ${analysis.id}`);
        console.log(`      Original: ${analysis.originalName}`);
        console.log(`      Input: ${analysis.inputFile}`);
        console.log(`      Operations: ${JSON.stringify(analysis.operations)}`);
        console.log(`      Created: ${analysis.createdAt.toISOString()}`);
        if (analysis.processedAt) {
          console.log(`      Processed: ${analysis.processedAt.toISOString()}`);
          const processingTime = analysis.processedAt.getTime() - analysis.createdAt.getTime();
          console.log(`      Processing Time: ${processingTime}ms`);
        }
        
        // File analysis
        console.log(`      📁 File Analysis:`);
        console.log(`         Exists: ${analysis.fileAnalysis.exists ? '✅' : '❌'}`);
        if (analysis.fileAnalysis.exists) {
          console.log(`         Size: ${Math.round((analysis.fileAnalysis.size || 0) / 1024)}KB`);
          console.log(`         Extension: ${analysis.fileAnalysis.extension}`);
          console.log(`         Is Image: ${analysis.fileAnalysis.isImage ? '✅' : '❌'}`);
          console.log(`         Sharp Compatible: ${analysis.fileAnalysis.readableBySharp ? '✅' : '❌'}`);
        }
        
        if (analysis.fileAnalysis.error) {
          console.log(`         ❌ Error: ${analysis.fileAnalysis.error}`);
        }
        
        if (analysis.failedReason) {
          console.log(`      ❌ Failed: ${analysis.failedReason}`);
        }
        
        // Show job result for completed jobs
        if (jobType === 'completed' && job.returnvalue) {
          console.log(`      ✅ Result: ${job.returnvalue.outputPath}`);
          
          // Check if output file exists
          try {
            const outputStats = await fs.stat(job.returnvalue.outputPath);
            console.log(`      📤 Output: ${Math.round(outputStats.size / 1024)}KB`);
          } catch {
            console.log(`      ❌ Output file missing!`);
          }
        }
      }
      
      if (jobs.length > 5) {
        console.log(`   ... and ${jobs.length - 5} more ${jobType} jobs`);
      }
    }
    
    // 2. Analyze uploads and processed directories
    console.log('\n\n2. 📂 DIRECTORY ANALYSIS...\n');
    
    const uploadsDir = 'uploads';
    const processedDir = 'processed';
    
    console.log(`📁 UPLOADS DIRECTORY: ${path.resolve(uploadsDir)}`);
    try {
      const uploadFiles = await fs.readdir(uploadsDir);
      console.log(`   Found ${uploadFiles.length} files`);
      
      let processedCount = 0;
      let unprocessedCount = 0;
      
      for (const file of uploadFiles.slice(0, 10)) { // Check first 10 files
        const filePath = path.join(uploadsDir, file);
        const fileAnalysis = await analyzeFile(filePath);
        
        // Check if this file was processed (look for corresponding output)
        const wasProcessed = allJobAnalyses.some(job => 
          job.inputFile.includes(file) && job.status === 'completed'
        );
        
        if (wasProcessed) {
          processedCount++;
          console.log(`   ✅ ${file} - PROCESSED`);
        } else {
          unprocessedCount++;
          console.log(`   ❌ ${file} - NOT PROCESSED`);
          console.log(`      Size: ${Math.round((fileAnalysis.size || 0) / 1024)}KB`);
          console.log(`      Sharp Compatible: ${fileAnalysis.readableBySharp ? '✅' : '❌'}`);
          if (fileAnalysis.error) {
            console.log(`      Error: ${fileAnalysis.error}`);
          }
        }
      }
      
      console.log(`\n   📊 SUMMARY: ${processedCount} processed, ${unprocessedCount} unprocessed`);
      
      if (uploadFiles.length > 10) {
        console.log(`   ... and ${uploadFiles.length - 10} more files not analyzed`);
      }
    } catch (error) {
      console.log(`   ❌ Error reading uploads directory: ${error}`);
    }
    
    console.log(`\n📁 PROCESSED DIRECTORY: ${path.resolve(processedDir)}`);
    try {
      const processedFiles = await fs.readdir(processedDir);
      console.log(`   Found ${processedFiles.length} processed files`);
      
      // Show some examples
      for (const file of processedFiles.slice(0, 5)) {
        const filePath = path.join(processedDir, file);
        try {
          const stats = await fs.stat(filePath);
          console.log(`   ✅ ${file} - ${Math.round(stats.size / 1024)}KB`);
        } catch (error) {
          console.log(`   ❌ ${file} - Error reading file`);
        }
      }
    } catch (error) {
      console.log(`   ❌ Error reading processed directory: ${error}`);
    }
    
    // 3. Pattern Analysis
    console.log('\n\n3. 🔍 PATTERN ANALYSIS...\n');
    
    const successfulJobs = allJobAnalyses.filter(j => j.status === 'completed');
    const failedJobs = allJobAnalyses.filter(j => j.status === 'failed');
    
    console.log(`📊 SUCCESS RATE: ${successfulJobs.length}/${allJobAnalyses.length} jobs succeeded`);
    
    if (failedJobs.length > 0) {
      console.log('\n❌ FAILURE ANALYSIS:');
      const failureReasons = failedJobs.reduce((acc, job) => {
        const reason = job.failedReason || 'Unknown error';
        acc[reason] = (acc[reason] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      
      Object.entries(failureReasons).forEach(([reason, count]) => {
        console.log(`   ${count}x: ${reason}`);
      });
    }
    
    // Check for patterns in successful vs failed operations
    console.log('\n🔄 OPERATION PATTERNS:');
    const operationSuccessRate: Record<string, { success: number; failed: number }> = {};
    
    allJobAnalyses.forEach(job => {
      const operations = Object.keys(job.operations);
      operations.forEach(op => {
        if (!operationSuccessRate[op]) {
          operationSuccessRate[op] = { success: 0, failed: 0 };
        }
        
        if (job.status === 'completed') {
          operationSuccessRate[op].success++;
        } else if (job.status === 'failed') {
          operationSuccessRate[op].failed++;
        }
      });
    });
    
    Object.entries(operationSuccessRate).forEach(([operation, stats]) => {
      const total = stats.success + stats.failed;
      const successRate = total > 0 ? Math.round((stats.success / total) * 100) : 0;
      console.log(`   ${operation}: ${successRate}% success (${stats.success}/${total})`);
    });
    
    // 4. Recommendations
    console.log('\n\n4. 💡 RECOMMENDATIONS...\n');
    
    if (failedJobs.some(j => !j.fileAnalysis.exists)) {
      console.log('⚠️  ISSUE: Input files missing for some jobs');
      console.log('   - Files may be deleted before processing completes');
      console.log('   - Consider disabling input file cleanup until job completes');
      console.log('   - Check file upload timing vs job processing timing');
    }
    
    if (failedJobs.some(j => j.fileAnalysis.exists && !j.fileAnalysis.readableBySharp)) {
      console.log('⚠️  ISSUE: Some files exist but Sharp cannot read them');
      console.log('   - Files may be corrupted or unsupported format');
      console.log('   - Add better file validation before job creation');
      console.log('   - Consider file format conversion pre-processing');
    }
    
    if (allJobAnalyses.some(j => j.status === 'active')) {
      console.log('⚠️  ISSUE: Jobs stuck in active state');
      console.log('   - Processing may be hanging');
      console.log('   - Consider reducing timeout or increasing concurrency');
    }
    
    const avgProcessingTime = successfulJobs
      .filter(j => j.processedAt)
      .reduce((sum, j) => {
        return sum + (j.processedAt!.getTime() - j.createdAt.getTime());
      }, 0) / successfulJobs.length;
    
    if (avgProcessingTime > 30000) { // More than 30 seconds
      console.log(`⚠️  ISSUE: Long processing times (avg: ${Math.round(avgProcessingTime/1000)}s)`);
      console.log('   - Consider optimizing Sharp operations');
      console.log('   - Increase Sharp concurrency from current setting of 1');
      console.log('   - Check if images are too large');
    }
    
    console.log('\n✅ DIAGNOSTIC COMPLETE!');
    console.log('\nNext steps:');
    console.log('1. Address any file missing issues');
    console.log('2. Validate image files before processing');
    console.log('3. Consider increasing Sharp concurrency');
    console.log('4. Monitor processing times');
    console.log('5. Review failed job error messages');
    
  } catch (error) {
    console.error('❌ Diagnostic failed:', error);
  } finally {
    process.exit(0);
  }
}

// Run the diagnostic
comprehensiveDiagnostic();