// process-orphaned-files.ts - Process the 8 unprocessed files in uploads

import { imageQueue } from './src/config/bullmq';
import fs from 'fs/promises';
import path from 'path';

interface OrphanedFile {
  fileName: string;
  filePath: string;
  originalName: string;
  size: number;
}

async function processOrphanedFiles() {
  console.log('🔄 PROCESSING ORPHANED FILES IN UPLOADS...\n');
  
  try {
    const uploadsDir = 'uploads';
    const files = await fs.readdir(uploadsDir);
    
    console.log(`📁 Found ${files.length} files in uploads directory`);
    
    // Get list of files that were already processed (from job history)
    const completedJobs = await imageQueue.getCompleted();
    const processedFilenames = new Set(
      completedJobs
        .map(job => path.basename(job.data?.filePath || ''))
        .filter(Boolean)
    );
    
    console.log(`📊 Found ${processedFilenames.size} already processed files in job history`);
    
    // Find unprocessed files
    const unprocessedFiles: OrphanedFile[] = [];
    
    for (const fileName of files) {
      if (!processedFilenames.has(fileName)) {
        const filePath = path.join(uploadsDir, fileName);
        
        try {
          const stats = await fs.stat(filePath);
          
          // Extract original name from the filename pattern: timestamp-hash-originalname
          const parts = fileName.split('-');
          const originalName = parts.length >= 3 
            ? parts.slice(2).join('-') // Everything after second dash
            : fileName;
          
          unprocessedFiles.push({
            fileName,
            filePath,
            originalName,
            size: stats.size
          });
        } catch (error) {
          console.warn(`⚠️ Could not stat file ${fileName}:`, error);
        }
      }
    }
    
    console.log(`\n🎯 Found ${unprocessedFiles.length} unprocessed files:`);
    unprocessedFiles.forEach((file, index) => {
      console.log(`   ${index + 1}. ${file.originalName} (${Math.round(file.size / 1024)}KB)`);
    });
    
    if (unprocessedFiles.length === 0) {
      console.log('✅ No orphaned files to process!');
      return;
    }
    
    console.log('\n🚀 Starting to process orphaned files...\n');
    
    let processed = 0;
    let failed = 0;
    
    for (const file of unprocessedFiles) {
      try {
        console.log(`📄 Processing: ${file.originalName}`);
        
        // Create a simple processing job (rotate 0 degrees - minimal operation)
        const jobData = {
          filePath: file.filePath,
          originalName: file.originalName,
          fileSize: file.size,
          mimeType: 'image/png', // Default, will be detected properly by worker
          uploadedAt: new Date(),
          operations: {
            rotate: 0, // Minimal operation - just convert to output format
            format: 'jpeg' as const,
            quality: 85
          },
          userId: 'orphan-processor',
          sessionId: 'batch-process',
          priority: 5
        };
        
        // Add job to queue
        const job = await imageQueue.add('process-image', jobData, {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
          removeOnComplete: false, // Keep job for tracking
          removeOnFail: false,
        });
        
        console.log(`   ✅ Job created: ${job.id}`);
        processed++;
        
        // Small delay to avoid overwhelming the queue
        await new Promise(resolve => setTimeout(resolve, 500));
        
      } catch (error) {
        console.error(`   ❌ Failed to create job for ${file.originalName}:`, error);
        failed++;
      }
    }
    
    console.log(`\n📊 PROCESSING SUMMARY:`);
    console.log(`   ✅ Jobs created: ${processed}`);
    console.log(`   ❌ Failed: ${failed}`);
    console.log(`   📋 Total files: ${unprocessedFiles.length}`);
    
    if (processed > 0) {
      console.log(`\n⏳ Jobs are now in the queue. Monitor with:`);
      console.log(`   npx ts-node -e "
        import { imageQueue } from './src/config/bullmq';
        (async () => {
          const counts = await imageQueue.getJobCounts('waiting', 'active', 'completed', 'failed');
          console.log('Queue status:', counts);
          process.exit(0);
        })();
      "`);
      
      console.log(`\n🔄 Your worker should now process these files automatically.`);
      console.log(`   Check the processed folder in a few minutes for results.`);
    }
    
  } catch (error) {
    console.error('❌ Failed to process orphaned files:', error);
  } finally {
    process.exit(0);
  }
}

// Helper function to monitor processing progress
async function monitorProgress() {
  console.log('📊 MONITORING PROCESSING PROGRESS...\n');
  
  const startTime = Date.now();
  const maxWaitTime = 5 * 60 * 1000; // 5 minutes
  
  while (Date.now() - startTime < maxWaitTime) {
    try {
      const counts = await imageQueue.getJobCounts('waiting', 'active', 'completed', 'failed');
      
      console.log(`⏰ ${new Date().toLocaleTimeString()} - Queue Status:`);
      console.log(`   Waiting: ${counts.waiting}`);
      console.log(`   Active: ${counts.active}`);
      console.log(`   Completed: ${counts.completed}`);
      console.log(`   Failed: ${counts.failed}`);
      
      if (counts.waiting === 0 && counts.active === 0) {
        console.log('\n✅ All jobs completed!');
        
        // Show final results
        const processed = await fs.readdir('processed');
        console.log(`📤 Processed directory now has ${processed.length} files`);
        break;
      }
      
      // Wait 10 seconds before next check
      await new Promise(resolve => setTimeout(resolve, 10000));
      
    } catch (error) {
      console.error('❌ Error monitoring progress:', error);
      break;
    }
  }
  
  console.log('\n📊 Monitoring complete.');
  process.exit(0);
}

// Check command line arguments
const args = process.argv.slice(2);

if (args.includes('--monitor')) {
  monitorProgress();
} else {
  processOrphanedFiles();
}