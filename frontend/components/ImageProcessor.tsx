"use client"
import React, { useState, useEffect } from "react";
import { Upload, Settings, RotateCcw, RotateCw, FlipHorizontal, FlipVertical, Crop, Download, X, Check, Loader, Scissors, Video } from 'lucide-react';

interface JobResult {
  jobId: string;
  filename: string;
  status: string;
  type?: 'image' | 'video'; // Added for video support
  progress?: number;
  estimatedProcessingTime?: string;
  queuePosition?: number;
  priority?: string;
  outputPath?: string;
  error?: string;
  result?: {
    width?: number; // Image only
    height?: number; // Image only
    duration?: number; // Video only
    format: string;
    originalSize: number;
    processedSize: number;
    processingTime: number;
    operations: string[];
    metadata?: {
      channels?: number;
      colorspace?: string;
      hasAlpha?: boolean;
      density?: number;
    };
  };
  originalSize?: string;
  processedSize?: string;
  operations?: string[];
}

interface ImageOperations {
  resize?: {
    width?: number;
    height?: number;
    fit: string;
    position: string;
  };
  crop?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  rotate?: number;
  flip?: boolean;
  flop?: boolean;
  format?: string;
  quality?: number;
  progressive?: boolean;
  lossless?: boolean;
  compression?: number;
  watermark?: {
    type: 'text' | 'image';
    text?: string;
    imagePath?: string;
    opacity: number;
    gravity: string;
  };
}

interface VideoOperations {
  crop?: {
    startTime: number;
    endTime: number;
  };
  format?: string;
  quality?: number;
  watermark?: {
    type: 'text' | 'image';
    text?: string;
    imagePath?: string;
    opacity: number;
    gravity: string;
    fontSize?: number; // For text watermark, if added later
  };
}

type ConnectionStatus = 'unknown' | 'connected' | 'error';
type ActivePanel = 'image' | 'video';

const PixQueueApp: React.FC = () => {
  const [activePanel, setActivePanel] = useState<ActivePanel>('image');
  const [imageFiles, setImageFiles] = useState<FileList | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [imageFilePreviews, setImageFilePreviews] = useState<string[]>([]);
  const [videoPreview, setVideoPreview] = useState<string>('');
  const [jobResults, setJobResults] = useState<JobResult[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('unknown');
  const [activeTab, setActiveTab] = useState<'transform' | 'quality'>('transform');

  // Image states
  const [resize, setResize] = useState<{ width?: number; height?: number; fit: string; position: string }>({ 
    fit: 'cover', 
    position: 'centre' 
  });
  const [rotate, setRotate] = useState(0);
  const [flip, setFlip] = useState(false);
  const [flop, setFlop] = useState(false);
  const [crop, setCrop] = useState<{ enabled: boolean; x: number; y: number; width: number; height: number }>({
    enabled: false,
    x: 0,
    y: 0,
    width: 200,
    height: 200
  });
  const [format, setFormat] = useState<string>('');
  const [quality, setQuality] = useState(85);
  const [progressive, setProgressive] = useState(false);
  const [lossless, setLossless] = useState(false);
  const [compression, setCompression] = useState(6);
  const [watermark, setWatermark] = useState<{
  enabled: boolean;
  type: 'text' | 'image';
  text: string;
  imagePath: string;
  opacity: number;
  gravity: string;
  fontSize: number;     // Add this
  color: string;        // Add this
}>({
  enabled: false,
  type: 'text',
  text: 'Sample Watermark',
  imagePath: '',
  opacity: 0.5,
  gravity: 'bottom-right',
  fontSize: 24,         // Default font size
  color: '#ffffff'      // Default color (white)
});

  // Video states (only crop for now)
  const [videoCrop, setVideoCrop] = useState<{ startTime: number; endTime: number }>({ startTime: 0, endTime: 60 });

  // Handle image file previews
  useEffect(() => {
    if (imageFiles) {
      const previews: string[] = [];
      Array.from(imageFiles).forEach((file) => {
        const url = URL.createObjectURL(file);
        previews.push(url);
      });
      setImageFilePreviews(previews);
    } else {
      setImageFilePreviews([]);
    }
    return () => {
      imageFilePreviews.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [imageFiles]);

  // Handle video preview (thumbnail)
  useEffect(() => {
    if (videoFile) {
      const url = URL.createObjectURL(videoFile);
      setVideoPreview(url);
    } else {
      setVideoPreview('');
    }
    return () => {
      if (videoPreview) URL.revokeObjectURL(videoPreview);
    };
  }, [videoFile]);

  // Test connection to backend
  const testConnection = async () => {
    try {
      const res = await fetch("http://localhost:5000/health", { method: "GET" });
      if (res.ok) {
        setConnectionStatus('connected');
      } else {
        setConnectionStatus('error');
      }
    } catch (error) {
      setConnectionStatus('error');
      console.error('Connection test failed:', error);
    }
  };

  // Generic check job status (handles both image and video)
  const checkJobStatus = async (jobId: string, type: 'image' | 'video'): Promise<any> => {
    try {
      const endpoint = type === 'image' ? `/upload/job/${jobId}/status` : `/video/job/${jobId}/status`;
      const res = await fetch(`http://localhost:5000${endpoint}`);
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      return await res.json();
    } catch (error) {
      console.error(`Failed to check status for job ${jobId}:`, error);
      return null;
    }
  };

  // Update job status
  const updateJobStatus = async (jobId: string, type: 'image' | 'video') => {
    const response = await checkJobStatus(jobId, type);
    if (response && response.success) {
      const statusData = response.data;
      setJobResults(prev => {
        const updated = prev.map(j => 
          j.jobId === jobId ? {
            ...j,
            status: statusData.status || 'pending',
            progress: statusData.progress,
            outputPath: statusData.outputPath || statusData.result?.outputPath,
            error: statusData.error || statusData.failedReason,
            result: statusData.result,
            type,
            originalSize: statusData.result?.originalSize ? `${Math.round(statusData.result.originalSize / 1024 / 1024)}MB` : undefined,
            processedSize: statusData.result?.processedSize ? `${Math.round(statusData.result.processedSize / 1024 / 1024)}MB` : undefined,
            operations: statusData.result?.operations
          } : j
        );
        return updated;
      });
    }
  };

  // Poll job statuses
  useEffect(() => {
    const interval = setInterval(async () => {
      const pendingJobs = jobResults.filter(job => 
        ['pending', 'processing', 'active', 'waiting'].includes(job.status || '')
      );
      for (const job of pendingJobs) {
        await updateJobStatus(job.jobId, job.type || 'image');
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [jobResults]);

  // Build image operations
  const buildImageOperations = (): ImageOperations => {
    const operations: ImageOperations = {};
    if (resize.width || resize.height) {
      operations.resize = { ...resize };
    }
    if (crop.enabled) {
      operations.crop = { ...crop, x: crop.x, y: crop.y, width: crop.width, height: crop.height };
    }
    if (rotate !== 0) operations.rotate = rotate;
    if (flip) operations.flip = true;
    if (flop) operations.flop = true;
    if (format) operations.format = format;
    if (quality !== 85) operations.quality = quality;
    if (progressive) operations.progressive = true;
    if (lossless) operations.lossless = true;
    if (compression !== 6) operations.compression = compression;
    if (watermark.enabled) {
      operations.watermark = {
        type: watermark.type,
        ...(watermark.type === 'text' ? { text: watermark.text } : { imagePath: watermark.imagePath }),
        opacity: watermark.opacity,
        gravity: watermark.gravity
      };
    }
    return operations;
  };

  // Build video operations (crop only)
  const buildVideoOperations = (): VideoOperations => {
    return {
      crop: {
        startTime: videoCrop.startTime,
        endTime: videoCrop.endTime
      }
    };
  };

  // Handle image upload
  const handleImageUpload = async () => {
    if (!imageFiles) return alert("Please select images");
    setIsUploading(true);
    try {
      const operations = buildImageOperations();
      const uploadPromises = Array.from(imageFiles).map(async (file) => {
        const formData = new FormData();
        formData.append("image", file);
        formData.append("operations", JSON.stringify(operations));
        const res = await fetch("http://localhost:5000/upload", { method: "POST", body: formData });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      });
      const responses = await Promise.all(uploadPromises);
      const newJobs: JobResult[] = [];
      responses.forEach((data) => {
        if (data.success && data.data && Array.isArray(data.data)) {
          data.data.forEach((item: any) => {
            newJobs.push({
              jobId: item.jobId,
              filename: item.fileName,
              status: 'waiting',
              type: 'image' as const,
              estimatedProcessingTime: item.estimatedProcessingTime,
              queuePosition: item.queuePosition,
              priority: item.priority
            });
          });
        }
      });
      setJobResults(prev => [...prev, ...newJobs]);
      newJobs.forEach((job, index) => setTimeout(() => updateJobStatus(job.jobId, 'image'), 1000 + index * 500));
      setConnectionStatus('connected');
      setImageFiles(null);
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      if (fileInput) fileInput.value = '';
    } catch (error) {
      alert(`Upload failed: ${error}`);
      setConnectionStatus('error');
    } finally {
      setIsUploading(false);
    }
  };

  // Handle video upload
  const handleVideoUpload = async () => {
    if (!videoFile) return alert("Please select a video");
    setIsUploading(true);
    try {
      const operations = buildVideoOperations();
      const formData = new FormData();
      formData.append("video", videoFile);
      formData.append("operations", JSON.stringify(operations));
      const res = await fetch("http://localhost:5000/video", { method: "POST", body: formData });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.success && data.data && Array.isArray(data.data)) {
        data.data.forEach((item: any) => {
          setJobResults(prev => [...prev, {
            jobId: item.jobId,
            filename: item.fileName,
            status: 'waiting',
            type: 'video' as const,
            estimatedProcessingTime: item.estimatedProcessingTime,
            queuePosition: item.queuePosition,
            priority: item.priority
          }]);
          setTimeout(() => updateJobStatus(item.jobId, 'video'), 1000);
        });
      }
      setConnectionStatus('connected');
      setVideoFile(null);
    } catch (error) {
      alert(`Upload failed: ${error}`);
      setConnectionStatus('error');
    } finally {
      setIsUploading(false);
    }
  };

  const downloadFile = async (jobId: string, filename: string, type: 'image' | 'video') => {
    try {
      const endpoint = type === 'image' ? `/upload/job/${jobId}/download` : `/video/job/${jobId}/download`;
      const downloadUrl = `http://localhost:5000${endpoint}`;
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      alert(`Download failed: ${error}`);
    }
  };

  const removeJob = (jobId: string) => setJobResults(prev => prev.filter(j => j.jobId !== jobId));
  const clearAllJobs = () => setJobResults([]);

  const resetImageSettings = () => {
    setResize({ width: 400, height: 300, fit: 'cover', position: 'centre' });
    setRotate(0); setFlip(false); setFlop(false);
    setCrop({ enabled: false, x: 0, y: 0, width: 200, height: 200 });
    setFormat(''); setQuality(85); setProgressive(false); setLossless(false); setCompression(6);
    setWatermark({ 
    enabled: false, 
    type: 'text', 
    text: 'Sample Watermark', 
    imagePath: '', 
    opacity: 0.5, 
    gravity: 'bottom-right',
    fontSize: 24,      // Add this
    color: '#ffffff'   // Add this
  });
  };

  const resetVideoSettings = () => setVideoCrop({ startTime: 0, endTime: 60 });

  useEffect(() => { testConnection(); }, []);

  const getStatusIcon = (status: string) => {
    switch (status.toLowerCase()) {
      case 'completed': return <Check className="w-4 h-4" />;
      case 'processing': case 'active': return <Loader className="w-4 h-4 animate-spin" />;
      case 'waiting': return <Loader className="w-4 h-4" />;
      case 'failed': case 'error': return <X className="w-4 h-4" />;
      default: return <Loader className="w-4 h-4" />;
    }
  };

  return (
    <div className="bg-zinc-950 text-white min-h-screen">
      {/* Header */}
      <div className="border-b border-zinc-800 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">PixQueue</h1>
              <p className="text-zinc-400 text-sm">Professional media processing</p>
            </div>
            <div className="flex items-center gap-3">
              <div className={`w-2 h-2 rounded-full ${connectionStatus === 'connected' ? 'bg-green-400' : connectionStatus === 'error' ? 'bg-red-400' : 'bg-yellow-400'}`}></div>
              <span className="text-sm text-zinc-400">
                {connectionStatus === 'connected' ? 'Connected' : connectionStatus === 'error' ? 'Disconnected' : 'Connecting...'}
              </span>
              <button onClick={testConnection} className="px-3 py-1 text-xs bg-zinc-800 hover:bg-zinc-700 rounded transition-colors">Test</button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Settings Panel */}
          <div className="lg:col-span-1">
            <div className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden sticky top-8">
              <div className="p-6 border-b border-zinc-800">
                <h2 className="text-lg font-semibold mb-2">Processing Settings</h2>
                <p className="text-zinc-400 text-sm">Configure transformations</p>
              </div>
              <div className="p-6 space-y-6">
                {/* Panel Tabs: Image / Video */}
                <div className="flex border-b border-zinc-700">
                  <button
                    onClick={() => { setActivePanel('image'); setActiveTab('transform'); }}
                    className={`flex-1 py-2 px-4 text-sm font-medium transition-colors ${
                      activePanel === 'image' ? 'border-b-2 border-purple-500 text-purple-400' : 'text-zinc-400 hover:text-zinc-300'
                    }`}
                  >
                    <img src="/image-icon.svg" alt="" className="inline w-4 h-4 mr-1" /> Images
                  </button>
                  <button
                    onClick={() => setActivePanel('video')}
                    className={`flex-1 py-2 px-4 text-sm font-medium transition-colors ${
                      activePanel === 'video' ? 'border-b-2 border-purple-500 text-purple-400' : 'text-zinc-400 hover:text-zinc-300'
                    }`}
                  >
                    <Video className="inline w-4 h-4 mr-1" /> Video
                  </button>
                </div>

                {activePanel === 'image' ? (
                  <>
                    {/* Image Upload */}
                    <div>
                      <label className="block text-sm font-medium text-zinc-300 mb-3">Select Images</label>
                      <div className="relative">
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          onChange={(e) => setImageFiles(e.target.files)}
                          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        />
                        <div className="bg-zinc-800 border-2 border-dashed border-zinc-700 rounded-lg p-6 text-center hover:border-purple-500 transition-colors">
                          <Upload className="w-8 h-8 text-zinc-500 mx-auto mb-2" />
                          <p className="text-sm text-zinc-400">{imageFiles ? `${imageFiles.length} file(s)` : 'Click or drag images'}</p>
                        </div>
                      </div>
                      {imageFilePreviews.length > 0 && (
                        <div className="mt-4 grid grid-cols-2 md:grid-cols-3 gap-2">
                          {imageFilePreviews.map((preview, i) => <img key={i} src={preview} alt={`Preview ${i}`} className="w-full h-20 object-cover rounded border border-zinc-700" />)}
                        </div>
                      )}
                    </div>

                    {/* Image Tabs */}
                    <div className="flex border-b border-zinc-700">
                      <button onClick={() => setActiveTab('transform')} className={`flex-1 py-2 px-4 text-sm font-medium transition-colors ${activeTab === 'transform' ? 'border-b-2 border-purple-500 text-purple-400' : 'text-zinc-400 hover:text-zinc-300'}`}>
                        Resize & Transform
                      </button>
                      <button onClick={() => setActiveTab('quality')} className={`flex-1 py-2 px-4 text-sm font-medium transition-colors ${activeTab === 'quality' ? 'border-b-2 border-purple-500 text-purple-400' : 'text-zinc-400 hover:text-zinc-300'}`}>
                        Quality & Watermark
                      </button>
                    </div>

                    {/* Image Tab Content */}
                    <div className="space-y-6">
                      {activeTab === 'transform' && (
                        <>
                          {/* Resize */}
                          <div>
                            <label className="block text-sm font-medium text-zinc-300 mb-3">Resize</label>
                            <div className="grid grid-cols-2 gap-2 mb-3">
                              <input type="number" placeholder="Width" value={resize.width || ''} onChange={(e) => setResize({ ...resize, width: e.target.value ? +e.target.value : undefined })} className="w-full p-2 bg-zinc-800 border border-zinc-700 rounded text-sm focus:border-purple-500 outline-none" />
                              <input type="number" placeholder="Height" value={resize.height || ''} onChange={(e) => setResize({ ...resize, height: e.target.value ? +e.target.value : undefined })} className="w-full p-2 bg-zinc-800 border border-zinc-700 rounded text-sm focus:border-purple-500 outline-none" />
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <select value={resize.fit} onChange={(e) => setResize({ ...resize, fit: e.target.value })} className="w-full p-2 bg-zinc-800 border border-zinc-700 rounded text-sm focus:border-purple-500 outline-none">
                                <option value="cover">Cover</option><option value="contain">Contain</option><option value="fill">Fill</option><option value="inside">Inside</option><option value="outside">Outside</option>
                              </select>
                              <select value={resize.position} onChange={(e) => setResize({ ...resize, position: e.target.value })} className="w-full p-2 bg-zinc-800 border border-zinc-700 rounded text-sm focus:border-purple-500 outline-none">
                                <option value="centre">Center</option><option value="top">Top</option><option value="bottom">Bottom</option><option value="left">Left</option><option value="right">Right</option>
                              </select>
                            </div>
                          </div>

                          {/* Transform */}
                          <div>
                            <label className="block text-sm font-medium text-zinc-300 mb-3">Transform</label>
                            <div className="space-y-2">
                              <div className="flex gap-2">
                                <button onClick={() => setRotate(rotate - 90)} className="flex-1 flex items-center justify-center gap-2 p-2 bg-zinc-800 hover:bg-zinc-700 rounded transition-colors">
                                  <RotateCcw className="w-4 h-4" /><span className="text-sm">Left</span>
                                </button>
                                <button onClick={() => setRotate(rotate + 90)} className="flex-1 flex items-center justify-center gap-2 p-2 bg-zinc-800 hover:bg-zinc-700 rounded transition-colors">
                                  <RotateCw className="w-4 h-4" /><span className="text-sm">Right</span>
                                </button>
                              </div>
                              <div className="text-center text-xs text-zinc-400">Current: {rotate}°</div>
                              <div className="flex gap-2">
                                <button onClick={() => setFlip(!flip)} className={`flex-1 flex items-center justify-center gap-2 p-2 rounded transition-colors ${flip ? 'bg-purple-600 text-white' : 'bg-zinc-800 hover:bg-zinc-700'}`}>
                                  <FlipVertical className="w-4 h-4" /><span className="text-sm">Flip V</span>
                                </button>
                                <button onClick={() => setFlop(!flop)} className={`flex-1 flex items-center justify-center gap-2 p-2 rounded transition-colors ${flop ? 'bg-purple-600 text-white' : 'bg-zinc-800 hover:bg-zinc-700'}`}>
                                  <FlipHorizontal className="w-4 h-4" /><span className="text-sm">Flip H</span>
                                </button>
                              </div>
                            </div>
                          </div>

                          {/* Crop */}
                          <div>
                            <label className="flex items-center gap-2 mb-3">
                              <input type="checkbox" checked={crop.enabled} onChange={(e) => setCrop({ ...crop, enabled: e.target.checked })} className="rounded" />
                              <span className="text-sm font-medium text-zinc-300">Enable Crop</span>
                            </label>
                            {crop.enabled && (
                              <div className="grid grid-cols-2 gap-2">
                                <input type="number" placeholder="X" value={crop.x} onChange={(e) => setCrop({ ...crop, x: +e.target.value })} className="w-full p-2 bg-zinc-800 border border-zinc-700 rounded text-sm focus:border-purple-500 outline-none" />
                                <input type="number" placeholder="Y" value={crop.y} onChange={(e) => setCrop({ ...crop, y: +e.target.value })} className="w-full p-2 bg-zinc-800 border border-zinc-700 rounded text-sm focus:border-purple-500 outline-none" />
                                <input type="number" placeholder="Width" value={crop.width} onChange={(e) => setCrop({ ...crop, width: +e.target.value })} className="w-full p-2 bg-zinc-800 border border-zinc-700 rounded text-sm focus:border-purple-500 outline-none" />
                                <input type="number" placeholder="Height" value={crop.height} onChange={(e) => setCrop({ ...crop, height: +e.target.value })} className="w-full p-2 bg-zinc-800 border border-zinc-700 rounded text-sm focus:border-purple-500 outline-none" />
                              </div>
                            )}
                          </div>
                        </>
                      )}
                      {activeTab === 'quality' && (
                        <>
                          {/* Format */}
                          <div>
                            <label className="block text-sm font-medium text-zinc-300 mb-3">Output Format</label>
                            <select value={format} onChange={(e) => setFormat(e.target.value)} className="w-full p-2 bg-zinc-800 border border-zinc-700 rounded text-sm focus:border-purple-500 outline-none">
                              <option value="">Keep Original</option><option value="jpeg">JPEG</option><option value="png">PNG</option><option value="webp">WebP</option><option value="avif">AVIF</option><option value="tiff">TIFF</option>
                            </select>
                          </div>

                          {/* Quality */}
                          <div>
                            <label className="block text-sm font-medium text-zinc-300 mb-2">Quality: {quality}%</label>
                            <input type="range" min="1" max="100" value={quality} onChange={(e) => setQuality(+e.target.value)} className="w-full h-2 bg-zinc-700 rounded-lg appearance-none cursor-pointer" style={{ background: `linear-gradient(to right, #a855f7 0%, #a855f7 ${quality}%, #3f3f46 ${quality}%, #3f3f46 100%)` }} />
                          </div>

                          {/* Compression Options */}
                          <div className="grid grid-cols-2 gap-4">
                            <label className="flex items-center gap-2"><input type="checkbox" checked={progressive} onChange={(e) => setProgressive(e.target.checked)} className="rounded" /><span className="text-sm text-zinc-300">Progressive</span></label>
                            <label className="flex items-center gap-2"><input type="checkbox" checked={lossless} onChange={(e) => setLossless(e.target.checked)} className="rounded" /><span className="text-sm text-zinc-300">Lossless</span></label>
                          </div>

                          {/* Compression Level */}
                          <div>
                            <label className="block text-sm font-medium text-zinc-300 mb-2">Compression: {compression}</label>
                            <input type="range" min="0" max="9" value={compression} onChange={(e) => setCompression(+e.target.value)} className="w-full h-2 bg-zinc-700 rounded-lg appearance-none cursor-pointer" />
                            <div className="flex justify-between text-xs text-zinc-400 mt-1"><span>0 (Fast)</span><span>9 (Best)</span></div>
                          </div>

                          {/* Watermark */}
                         <div>
  <label className="flex items-center gap-2 mb-3">
    <input 
      type="checkbox" 
      checked={watermark.enabled} 
      onChange={(e) => setWatermark({ ...watermark, enabled: e.target.checked })} 
      className="rounded" 
    />
    <span className="text-sm font-medium text-zinc-300">Watermark</span>
  </label>
  
  {watermark.enabled && (
    <div className="space-y-3">
      {/* Type Selection */}
      <div className="flex gap-2">
        <button 
          onClick={() => setWatermark({ ...watermark, type: 'text' })} 
          className={`flex-1 p-2 text-sm rounded transition-colors ${
            watermark.type === 'text' 
              ? 'bg-purple-600 text-white' 
              : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
          }`}
        >
          Text
        </button>
        <button 
          onClick={() => setWatermark({ ...watermark, type: 'image' })} 
          className={`flex-1 p-2 text-sm rounded transition-colors ${
            watermark.type === 'image' 
              ? 'bg-purple-600 text-white' 
              : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
          }`}
        >
          Image
        </button>
      </div>
      
      {/* Content Input */}
      {watermark.type === 'text' ? (
        <div className="space-y-3">
          <input 
            type="text" 
            value={watermark.text} 
            onChange={(e) => setWatermark({ ...watermark, text: e.target.value })} 
            placeholder="Watermark text" 
            className="w-full p-2 bg-zinc-800 border border-zinc-700 rounded text-sm focus:border-purple-500 outline-none" 
          />
          
          {/* Font Size */}
          <div>
            <label className="block text-xs text-zinc-400 mb-1">
              Font Size: {watermark.fontSize}px
            </label>
            <input 
              type="range" 
              min="12" 
              max="72" 
              value={watermark.fontSize} 
              onChange={(e) => setWatermark({ ...watermark, fontSize: Number(e.target.value) })} 
              className="w-full h-2 bg-zinc-700 rounded-lg appearance-none cursor-pointer"
              style={{
                background: `linear-gradient(to right, #a855f7 0%, #a855f7 ${((watermark.fontSize - 12) / (72 - 12)) * 100}%, #3f3f46 ${((watermark.fontSize - 12) / (72 - 12)) * 100}%, #3f3f46 100%)`
              }}
            />
          </div>
          
          {/* Color Picker */}
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Text Color</label>
            <div className="flex gap-2 items-center">
              <input 
                type="color" 
                value={watermark.color} 
                onChange={(e) => setWatermark({ ...watermark, color: e.target.value })} 
                className="w-12 h-8 bg-zinc-800 border border-zinc-700 rounded cursor-pointer"
                style={{ padding: '2px' }}
              />
              <input 
                type="text" 
                value={watermark.color} 
                onChange={(e) => setWatermark({ ...watermark, color: e.target.value })} 
                placeholder="#ffffff" 
                className="flex-1 p-2 bg-zinc-800 border border-zinc-700 rounded text-sm focus:border-purple-500 outline-none font-mono"
              />
            </div>
          </div>
        </div>
      ) : (
        <input 
          type="text" 
          value={watermark.imagePath} 
          onChange={(e) => setWatermark({ ...watermark, imagePath: e.target.value })} 
          placeholder="Image path or URL" 
          className="w-full p-2 bg-zinc-800 border border-zinc-700 rounded text-sm focus:border-purple-500 outline-none" 
        />
      )}
      
      {/* Position Selection */}
      <select 
        value={watermark.gravity} 
        onChange={(e) => setWatermark({ ...watermark, gravity: e.target.value })} 
        className="w-full p-2 bg-zinc-800 border border-zinc-700 rounded text-sm focus:border-purple-500 outline-none"
      >
        <option value="top-left">Top Left</option>
        <option value="top">Top Center</option>
        <option value="top-right">Top Right</option>
        <option value="left">Left Center</option>
        <option value="center">Center</option>
        <option value="right">Right Center</option>
        <option value="bottom-left">Bottom Left</option>
        <option value="bottom">Bottom Center</option>
        <option value="bottom-right">Bottom Right</option>
      </select>
      
      {/* Opacity */}
      <div>
        <label className="block text-xs text-zinc-400 mb-1">
          Opacity: {Math.round(watermark.opacity * 100)}%
        </label>
        <input 
          type="range" 
          min="0.1" 
          max="1" 
          step="0.1" 
          value={watermark.opacity} 
          onChange={(e) => setWatermark({ ...watermark, opacity: Number(e.target.value) })} 
          className="w-full h-1 bg-zinc-700 rounded appearance-none cursor-pointer"
          style={{
            background: `linear-gradient(to right, #a855f7 0%, #a855f7 ${watermark.opacity * 100}%, #3f3f46 ${watermark.opacity * 100}%, #3f3f46 100%)`
          }}
        />
      </div>
    </div>
  )}
</div>
                        </>
                      )}
                    </div>

                    {/* Image Actions */}
                    <div className="space-y-3 pt-4 border-t border-zinc-800">
                      <button onClick={handleImageUpload} disabled={isUploading || !imageFiles || connectionStatus !== 'connected'} className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-zinc-700 disabled:cursor-not-allowed text-white px-4 py-3 rounded-lg font-medium transition-colors flex items-center justify-center gap-2">
                        {isUploading ? <><Loader className="w-4 h-4 animate-spin" /> Processing...</> : <><Upload className="w-4 h-4" /> Process Images</>}
                      </button>
                      <button onClick={resetImageSettings} className="w-full bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-4 py-2 rounded-lg font-medium transition-colors">Reset</button>
                    </div>
                  </>
                ) : (
                  <>
                    {/* Video Upload */}
                    <div>
                      <label className="block text-sm font-medium text-zinc-300 mb-3">Select Video (Single File)</label>
                      <div className="relative">
                        <input type="file" accept="video/*" onChange={(e) => setVideoFile(e.target.files?.[0] || null)} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                        <div className="bg-zinc-800 border-2 border-dashed border-zinc-700 rounded-lg p-6 text-center hover:border-purple-500 transition-colors">
                          <Video className="w-8 h-8 text-zinc-500 mx-auto mb-2" />
                          <p className="text-sm text-zinc-400">{videoFile ? videoFile.name : 'Click or drag video'}</p>
                        </div>
                      </div>
                      {videoPreview && (
                        <div className="mt-4">
                          <video src={videoPreview} controls className="w-full h-24 object-cover rounded border border-zinc-700">
                            Your browser does not support the video tag.
                          </video>
                        </div>
                      )}
                    </div>

                    {/* Video Crop */}
                    <div>
                      <label className="block text-sm font-medium text-zinc-300 mb-3">Crop (Trim) Video</label>
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-2">
                          <input type="number" placeholder="Start Time (s)" value={videoCrop.startTime} onChange={(e) => setVideoCrop({ ...videoCrop, startTime: +e.target.value })} min="0" className="w-full p-2 bg-zinc-800 border border-zinc-700 rounded text-sm focus:border-purple-500 outline-none" />
                          <input type="number" placeholder="End Time (s)" value={videoCrop.endTime} onChange={(e) => setVideoCrop({ ...videoCrop, endTime: +e.target.value })} min="1" className="w-full p-2 bg-zinc-800 border border-zinc-700 rounded text-sm focus:border-purple-500 outline-none" />
                        </div>
                        <div className="text-center text-xs text-zinc-400">Duration: {videoCrop.endTime - videoCrop.startTime}s</div>
                        <div className="flex justify-center">
                          <Scissors className="w-5 h-5 text-zinc-500" />
                        </div>
                      </div>
                    </div>

                    {/* Video Actions */}
                    <div className="space-y-3 pt-4 border-t border-zinc-800">
                      <button onClick={handleVideoUpload} disabled={isUploading || !videoFile || connectionStatus !== 'connected'} className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-zinc-700 disabled:cursor-not-allowed text-white px-4 py-3 rounded-lg font-medium transition-colors flex items-center justify-center gap-2">
                        {isUploading ? <><Loader className="w-4 h-4 animate-spin" /> Processing...</> : <><Upload className="w-4 h-4" /> Process Video</>}
                      </button>
                      <button onClick={resetVideoSettings} className="w-full bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-4 py-2 rounded-lg font-medium transition-colors">Reset</button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Results Panel - Unified for Image/Video */}
          <div className="lg:col-span-2">
            <div className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden">
              <div className="p-6 border-b border-zinc-800 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold">Processing Queue</h2>
                  <p className="text-zinc-400 text-sm">Track all jobs (images & videos)</p>
                </div>
                {jobResults.length > 0 && (
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-zinc-400">{jobResults.length} jobs</span>
                    <button onClick={clearAllJobs} className="px-3 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded text-sm transition-colors">Clear All</button>
                  </div>
                )}
              </div>
              <div className="p-6">
                {jobResults.length === 0 ? (
                  <div className="text-center py-12">
                    <div className="w-16 h-16 bg-zinc-800 rounded-full flex items-center justify-center mx-auto mb-4">
                      <Settings className="w-8 h-8 text-zinc-500" />
                    </div>
                    <h3 className="text-lg font-medium mb-2 text-zinc-300">No jobs yet</h3>
                    <p className="text-zinc-500 text-sm">Upload media to start</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {jobResults.map((job) => (
                      <div key={job.jobId} className="bg-zinc-800 rounded-xl p-4 border border-zinc-700">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-3">
                            <div className={`p-2 rounded-full ${job.status === 'completed' ? 'bg-green-500/20 text-green-400' : job.status === 'processing' || job.status === 'active' ? 'bg-blue-500/20 text-blue-400' : job.status === 'failed' ? 'bg-red-500/20 text-red-400' : 'bg-yellow-500/20 text-yellow-400'}`}>
                              {getStatusIcon(job.status)}
                            </div>
                            <div>
                              <h4 className="font-medium text-zinc-200">{job.filename}</h4>
                              <p className="text-xs text-zinc-500 font-mono">{job.jobId}</p>
                              {job.queuePosition && job.queuePosition > 0 && <p className="text-xs text-orange-400">Queue: #{job.queuePosition}</p>}
                              {job.type === 'video' && <span className="text-xs text-blue-400">Video</span>}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {job.priority && <span className={`px-2 py-1 rounded text-xs font-medium ${job.priority === 'high' ? 'bg-red-500/20 text-red-400' : 'bg-zinc-500/20 text-zinc-400'}`}>{job.priority.toUpperCase()}</span>}
                            <span className={`px-2 py-1 rounded text-xs font-medium ${job.status === 'completed' ? 'bg-green-500/20 text-green-400' : job.status === 'processing' || job.status === 'active' ? 'bg-blue-500/20 text-blue-400' : job.status === 'failed' ? 'bg-red-500/20 text-red-400' : 'bg-yellow-500/20 text-yellow-400'}`}>
                              {job.status.toUpperCase()}
                            </span>
                            <button onClick={() => removeJob(job.jobId)} className="text-zinc-500 hover:text-red-400 transition-colors p-1"><X className="w-3 h-3" /></button>
                          </div>
                        </div>

                        {/* Progress */}
                        {['processing', 'active'].includes(job.status || '') && job.progress && (
                          <div className="mb-3">
                            <div className="w-full bg-zinc-700 rounded-full h-2">
                              <div className="bg-gradient-to-r from-purple-500 to-blue-500 h-2 rounded-full transition-all duration-300" style={{ width: `${job.progress}%` }} />
                            </div>
                            <div className="flex justify-between text-xs text-zinc-400 mt-1"><span>Processing...</span><span>{job.progress}%</span></div>
                          </div>
                        )}

                        {/* Details */}
                        {(job.originalSize || job.processedSize || job.result) && (
                          <div className="bg-zinc-900 rounded-lg p-3 mb-3">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                              {job.originalSize && <div className="text-center"><div className="text-zinc-400">Original</div><div className="font-medium text-zinc-200">{job.originalSize}</div></div>}
                              {job.processedSize && <div className="text-center"><div className="text-zinc-400">Processed</div><div className="font-medium text-zinc-200">{job.processedSize}</div></div>}
                              {job.result && (
                                <>
                                  {job.type === 'image' ? (
                                    <>
                                      <div className="text-center"><div className="text-zinc-400">Width</div><div className="font-medium text-zinc-200">{job.result.width}</div></div>
                                      <div className="text-center"><div className="text-zinc-400">Height</div><div className="font-medium text-zinc-200">{job.result.height}</div></div>
                                    </>
                                  ) : (
                                    <div className="text-center col-span-2 md:col-span-4"><div className="text-zinc-400">Duration</div><div className="font-medium text-zinc-200">{job.result.duration}s</div></div>
                                  )}
                                  <div className="text-center"><div className="text-zinc-400">Format</div><div className="font-medium text-zinc-200 uppercase">{job.result.format}</div></div>
                                </>
                              )}
                            </div>
                            {job.result?.processingTime && <div className="mt-2 text-center"><div className="text-xs text-zinc-400">Time: {job.result.processingTime}ms</div></div>}
                            {job.operations && job.operations.length > 0 && (
                              <div className="mt-3 pt-3 border-t border-zinc-800">
                                <div className="text-xs text-zinc-400 mb-2">Operations:</div>
                                <div className="flex flex-wrap gap-1">{job.operations.map((op, i) => <span key={i} className="px-2 py-1 bg-purple-500/20 text-purple-300 rounded text-xs">{op}</span>)}</div>
                              </div>
                            )}
                          </div>
                        )}

                        {job.estimatedProcessingTime && job.status === 'waiting' && <div className="mb-3 text-xs text-zinc-400">Est. time: {job.estimatedProcessingTime}</div>}

                        {job.status === 'failed' && job.error && (
                          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 mb-3">
                            <div className="text-red-400 text-sm font-medium mb-1">Error</div>
                            <div className="text-red-300 text-sm">{job.error}</div>
                          </div>
                        )}

                        {/* Actions */}
                        <div className="flex gap-2">
                          {job.status === 'completed' && (
                            <button onClick={() => downloadFile(job.jobId, job.filename, job.type || 'image')} className="flex-1 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg font-medium transition-colors flex items-center justify-center gap-2">
                              <Download className="w-4 h-4" /> Download
                            </button>
                          )}
                          {['processing', 'active', 'waiting', 'pending'].includes(job.status || '') && (
                            <button onClick={() => updateJobStatus(job.jobId, job.type || 'image')} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition-colors flex items-center justify-center gap-2">
                              <Loader className="w-4 h-4" /> Refresh
                            </button>
                          )}
                          {job.status === 'failed' && (
                            <button onClick={() => removeJob(job.jobId)} className="flex-1 bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg font-medium transition-colors flex items-center justify-center gap-2">
                              <X className="w-4 h-4" /> Remove
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <style jsx>{`
        input[type="range"] { -webkit-appearance: none; appearance: none; }
        input[type="range"]::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; height: 16px; width: 16px; background: #a855f7; border-radius: 50%; cursor: pointer; border: 2px solid #18181b; box-shadow: 0 2px 4px rgba(0,0,0,0.2); }
        input[type="range"]::-webkit-slider-thumb:hover { background: #9333ea; transform: scale(1.1); }
        input[type="range"]::-moz-range-thumb { height: 16px; width: 16px; background: #a855f7; border-radius: 50%; cursor: pointer; border: 2px solid #18181b; box-shadow: 0 2px 4px rgba(0,0,0,0.2); }
      `}</style>
    </div>
  );
};

export default PixQueueApp;