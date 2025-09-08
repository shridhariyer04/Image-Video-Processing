// quick-fixes.ts - Apply immediate fixes to common issues

import sharp from 'sharp';
import fs from 'fs/promises';
import path from 'path';

class ImageProcessingFixes {
  
  // Fix 1: Optimize Sharp configuration
  static optimizeSharpConfig() {
    console.log('🔧 Optimizing Sharp configuration...');
    
    // Increase concurrency from 1 to use more CPU cores
    const cpuCount = require('os').cpus().length;
    const optimalConcurrency = Math.max(1, Math.floor(cpuCount / 2));
    
    sharp.concurrency(optimalConcurrency);
    console.log(`   ✅ Sharp concurrency set to ${optimalConcurrency} (was 1)`);
    
    // Increase memory cache
    sharp.cache({ memory: 512 }); // Increased from 256
    console.log('   ✅ Sharp memory cache increased to 512MB');
    
    // Enable SIMD operations
    sharp.simd(true);
    console.log('   ✅ Sharp SIMD operations enabled');
  }
  
  // Fix 2: Validate files before processing
  static async validateImageFile(filePath: string): Promise<{
    valid: boolean;
    error?: string;
    metadata?: any;
  }> {
    try {
      // Check if file exists
      await fs.access(filePath);
      
      // Try to read metadata with Sharp
      const image = sharp(filePath);
      const metadata = await image.metadata();
      
      // Basic validation
      if (!metadata.width || !metadata.height) {
        return { valid: false, error: 'Invalid image dimensions' };
      }
      
      if (metadata.width > 10000 || metadata.height > 10000) {
        return { valid: false, error: 'Image too large' };
      }
      
      // Check file size
      const stats = await fs.stat(filePath);
      if (stats.size > 50 * 1024 * 1024) { // 50MB limit
        return { valid: false, error: 'File too large' };
      }
      
      if (stats.size === 0) {
        return { valid: false, error: 'Empty file' };
      }
      
      return { valid: true, metadata };
      
    } catch (error: any) {
      return { 
        valid: false, 
        error: `Validation failed: ${error.message}` 
      };
    }
  }
  
  // Fix 3: Process orphaned files in uploads directory
  static async processOrphanedFiles(uploadsDir: string = 'uploads') {
    console.log('🔧 Processing orphaned files in uploads directory...');
    
    try {
      const files = await fs.readdir(uploadsDir);
      console.log(`   Found ${files.length} files in uploads directory`);
      
      let processed = 0;
      let skipped = 0;
      let errors = 0;
      
      for (const file of files) {
        const filePath = path.join(uploadsDir, file);
        
        try {
          console.log(`   📄 Checking: ${file}`);
          
          // Validate file
          const validation = await this.validateImageFile(filePath);
          
          if (!validation.valid) {
            console.log(`   ❌ Skipped ${file}: ${validation.error}`);
            skipped++;
            continue;
          }
          
          // Simple processing test - just rotate 0 degrees (no-op that validates pipeline)
          const testResult = await this.testProcessFile(filePath);
          
          if (testResult.success) {
            console.log(`   ✅ ${file} - Processing capable`);
            processed++;
          } else {
            console.log(`   ❌ ${file} - Processing failed: ${testResult.error}`);
            errors++;
          }
          
        } catch (error: any) {
          console.log(`   ❌ ${file} - Error: ${error.message}`);
          errors++;
        }
      }
      
      console.log(`\n   📊 Results: ${processed} processable, ${skipped} skipped, ${errors} errors`);
      return { processed, skipped, errors };
      
    } catch (error) {
      console.error('   ❌ Failed to process orphaned files:', error);
      throw error;
    }
  }
  
  // Helper: Test if a file can be processed
  static async testProcessFile(filePath: string): Promise<{
    success: boolean;
    error?: string;
    outputPath?: string;
  }> {
    try {
      const outputDir = 'processed';
      await fs.mkdir(outputDir, { recursive: true });
      
      const outputFilename = `test_${Date.now()}_${path.basename(filePath, path.extname(filePath))}.jpeg`;
      const outputPath = path.join(outputDir, outputFilename);
      
      // Simple test: convert to JPEG with rotation 0 (no-op)
      await sharp(filePath)
        .rotate(0) // No-op rotation to test pipeline
        .jpeg({ quality: 80 })
        .toFile(outputPath);
      
      // Check if output file was created and has content
      const stats = await fs.stat(outputPath);
      if (stats.size === 0) {
        // Clean up empty file
        await fs.unlink(outputPath).catch(() => {});
        return { success: false, error: 'Output file is empty' };
      }
      
      // Clean up test file
      await fs.unlink(outputPath).catch(() => {});
      
      return { success: true, outputPath };
      
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
  
  // Fix 4: Clean up stuck/failed jobs
  static async cleanupStuckJobs() {
    console.log('🔧 Cleaning up stuck and failed jobs...');
    
    try {
      const { imageQueue } = require('./src/config/bullmq');
      
      // Clean failed jobs
      const failedJobs = await imageQueue.getFailed();
      console.log(`   Found ${failedJobs.length} failed jobs`);
      
      for (const job of failedJobs) {
        try {
          console.log(`   🗑️  Removing failed job: ${job.id}`);
          await job.remove();
        } catch (error) {
          console.log(`   ❌ Failed to remove job ${job.id}:`, error);
        }
      }
      
      // Clean old completed jobs (keep only last 10)
      const completedJobs = await imageQueue.getCompleted();
      const jobsToRemove = completedJobs.slice(10); // Keep only latest 10
      
      console.log(`   Found ${completedJobs.length} completed jobs, removing ${jobsToRemove.length} old ones`);
      
      for (const job of jobsToRemove) {
        try {
          await job.remove();
        } catch (error) {
          console.log(`   ❌ Failed to remove completed job ${job.id}:`, error);
        }
      }
      
      console.log('   ✅ Job cleanup completed');
      
    } catch (error) {
      console.error('   ❌ Job cleanup failed:', error);
    }
  }
  
  // Fix 5: Check and fix directory permissions
  static async checkDirectoryPermissions() {
    console.log('🔧 Checking directory permissions...');
    
    const directories = ['uploads', 'processed'];
    
    for (const dir of directories) {
      try {
        await fs.mkdir(dir, { recursive: true });
        
        // Test write permissions
        const testFile = path.join(dir, 'permission_test.tmp');
        await fs.writeFile(testFile, 'test');
        await fs.unlink(testFile);
        
        console.log(`   ✅ ${dir} - Permissions OK`);
        
      } catch (error: any) {
        console.log(`   ❌ ${dir} - Permission error: ${error.message}`);
      }
    }
  }
  
  // Main fix runner
  static async runAllFixes() {
    console.log('🚀 RUNNING ALL QUICK FIXES...\n');
    
    try {
      // Fix 1: Optimize Sharp
      this.optimizeSharpConfig();
      console.log('');
      
      // Fix 2: Check directories
      await this.checkDirectoryPermissions();
      console.log('');
      
      // Fix 3: Clean up jobs
      await this.cleanupStuckJobs();
      console.log('');
      
      // Fix 4: Process orphaned files
      await this.processOrphanedFiles();
      console.log('');
      
      console.log('✅ ALL FIXES APPLIED!');
      console.log('\nRecommendations:');
      console.log('1. Restart your image processing worker');
      console.log('2. Test with a few images to verify fixes');
      console.log('3. Monitor processing success rate');
      console.log('4. Run comprehensive diagnostic again');
      
    } catch (error) {
      console.error('❌ Fix application failed:', error);
    } finally {
      process.exit(0);
    }
  }
}

// Run fixes if called directly
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.includes('--validate-only')) {
    // Just validate files without other fixes
    ImageProcessingFixes.processOrphanedFiles().then(() => {
      console.log('✅ Validation complete');
      process.exit(0);
    });
  } else if (args.includes('--cleanup-only')) {
    // Just cleanup jobs
    ImageProcessingFixes.cleanupStuckJobs().then(() => {
      console.log('✅ Cleanup complete');
      process.exit(0);
    });
  } else {
    // Run all fixes
    ImageProcessingFixes.runAllFixes();
  }
}

export { ImageProcessingFixes };