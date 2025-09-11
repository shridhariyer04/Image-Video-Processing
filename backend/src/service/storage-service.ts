// src/service/storage.service.ts
import { createClient } from '@supabase/supabase-js';
import fs from 'fs/promises';
import {SUPABASE_URL, SUPABASE_ANON_KEY} from '../config/env'
const supabase = createClient(SUPABASE_URL!,SUPABASE_ANON_KEY!
);

const USE_CLOUD_STORAGE = process.env.NODE_ENV === 'production';

export class StorageService {
  static async saveProcessedFile(localPath: string, fileName: string, type: 'image' | 'video' = 'image'): Promise<string> {
    if (!USE_CLOUD_STORAGE) {
      return localPath; // Keep local in development
    }

    try {
      const fileBuffer = await fs.readFile(localPath);
      const bucketName = type === 'video' ? 'processed-videos' : 'processed-images';
      const filePath = `${type}s/${Date.now()}-${fileName}`;
      
      const { data, error } = await supabase.storage
        .from(bucketName)
        .upload(filePath, fileBuffer, {
          cacheControl: '3600',
          upsert: false
        });

      if (error) throw error;

      // Get public URL
      const { data: publicData } = supabase.storage
        .from(bucketName)
        .getPublicUrl(data.path);

      // Clean up local file after successful upload
      await fs.unlink(localPath);
      
      return publicData.publicUrl;
    } catch (error) {
      console.error('Failed to upload to Supabase:', error);
      // Fallback to local path if upload fails
      return localPath;
    }
  }

  static async cleanup(pathOrUrl: string): Promise<void> {
    if (!pathOrUrl.includes('supabase')) {
      // It's a local file, try to delete it
      try {
        await fs.unlink(pathOrUrl);
      } catch (error) {
        // File might not exist, ignore
      }
    }
    // For Supabase files, we don't auto-delete (you can add this later if needed)
  }
}