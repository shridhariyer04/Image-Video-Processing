import React from 'react';
import { JobResult } from '../types';

interface JobResultsProps {
  jobResults: JobResult[];
  onDownloadFile: (jobId: string, filename: string) => void;
  onUpdateJobStatus: (jobId: string) => void;
  onRemoveJob: (jobId: string) => void;
  onClearAllJobs: () => void;
}

const JobResults: React.FC<JobResultsProps> = ({
  jobResults,
  onDownloadFile,
  onUpdateJobStatus,
  onRemoveJob,
  onClearAllJobs
}) => {
  const getStatusColor = (status: string) => {
    if (!status) return 'text-gray-600 bg-gray-50 border-gray-200';
    
    switch (status.toLowerCase()) {
      case 'completed': return 'text-green-600 bg-green-50 border-green-200';
      case 'processing':
      case 'active': return 'text-blue-600 bg-blue-50 border-blue-200';
      case 'waiting': return 'text-yellow-600 bg-yellow-50 border-yellow-200';
      case 'failed': 
      case 'error': return 'text-red-600 bg-red-50 border-red-200';
      default: return 'text-gray-600 bg-gray-50 border-gray-200';
    }
  };

  const getStatusIcon = (status: string) => {
    if (!status) return '🔄';
    
    switch (status.toLowerCase()) {
      case 'completed': return '✅';
      case 'processing':
      case 'active': return '⚙️';
      case 'waiting': return '⏳';
      case 'failed':
      case 'error': return '❌';
      default: return '🔄';
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority?.toLowerCase()) {
      case 'high': return 'text-red-600 bg-red-50';
      case 'normal': return 'text-blue-600 bg-blue-50';
      case 'low': return 'text-gray-600 bg-gray-50';
      default: return 'text-gray-600 bg-gray-50';
    }
  };

  const formatFileSize = (size: number | string) => {
    if (typeof size === 'string') return size;
    if (!size) return 'Unknown';
    return `${Math.round(size / 1024)}KB`;
  };

  const calculateCompressionRatio = (job: JobResult) => {
    if (!job.result?.originalSize || !job.result?.processedSize) return null;
    const ratio = (1 - job.result.processedSize / job.result.originalSize) * 100;
    return ratio > 0 ? `${ratio.toFixed(1)}%` : 'Expanded';
  };

  return (
    <div className="bg-white rounded-2xl shadow-lg border border-gray-200 overflow-hidden">
      <div className="bg-gradient-to-r from-purple-600 to-pink-600 px-6 py-4 flex items-center justify-between">
        <h2 className="text-xl font-bold text-white">Processing Results</h2>
        {jobResults.length > 0 && (
          <div className="flex space-x-2">
            <span className="px-3 py-1 bg-white bg-opacity-20 text-white rounded-lg text-sm">
              {jobResults.length} jobs
            </span>
            <button
              onClick={onClearAllJobs}
              className="px-3 py-1 bg-white bg-opacity-20 text-white rounded-lg hover:bg-opacity-30 transition-colors text-sm"
            >
              Clear All
            </button>
          </div>
        )}
      </div>
      
      <div className="p-6">
        {jobResults.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-6xl mb-4">📤</div>
            <p className="text-gray-500 text-lg">No images processed yet</p>
            <p className="text-gray-400 text-sm">Upload some images to see results here</p>
          </div>
        ) : (
          <div className="space-y-6">
            {jobResults.map((job) => (
              <div key={job.jobId} className="border border-gray-200 rounded-xl p-6 bg-gray-50 hover:shadow-md transition-shadow">
                {/* Job Header */}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center space-x-4">
                    <span className="text-3xl">{getStatusIcon(job.status)}</span>
                    <div>
                      <h3 className="font-semibold text-gray-800 text-lg">{job.filename}</h3>
                      <p className="text-xs text-gray-500 font-mono">{job.jobId}</p>
                      {job.estimatedProcessingTime && (
                        <p className="text-xs text-blue-600">Est. time: {job.estimatedProcessingTime}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center space-x-3">
                    {job.priority && (
                      <span className={`px-2 py-1 rounded text-xs font-medium ${getPriorityColor(job.priority)}`}>
                        {job.priority.toUpperCase()}
                      </span>
                    )}
                    {job.queuePosition && job.queuePosition > 0 && (
                      <span className="px-2 py-1 bg-orange-100 text-orange-800 rounded text-xs font-medium">
                        Queue: #{job.queuePosition}
                      </span>
                    )}
                    <span className={`px-3 py-1 rounded-full text-xs font-medium border ${getStatusColor(job.status || 'pending')}`}>
                      {(job.status || 'pending').toUpperCase()}
                      {job.progress && (job.status === 'processing' || job.status === 'active') && ` (${job.progress}%)`}
                    </span>
                    <button
                      onClick={() => onRemoveJob(job.jobId)}
                      className="text-gray-400 hover:text-red-600 transition-colors p-1"
                      title="Remove"
                    >
                      ✕
                    </button>
                  </div>
                </div>

                {/* Progress Bar */}
                {(job.status === 'processing' || job.status === 'active') && job.progress && (
                  <div className="mb-4">
                    <div className="w-full bg-gray-200 rounded-full h-3">
                      <div 
                        className="bg-gradient-to-r from-blue-500 to-purple-500 h-3 rounded-full transition-all duration-300 flex items-center justify-center"
                        style={{ width: `${job.progress}%` }}
                      >
                        {job.progress > 20 && (
                          <span className="text-white text-xs font-medium">{job.progress}%</span>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Job Details Grid */}
                {(job.originalSize || job.processedSize || job.operations || job.result) && (
                  <div className="bg-white rounded-lg p-4 mb-4">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      {job.originalSize && (
                        <div className="text-center p-2 bg-gray-50 rounded">
                          <div className="font-medium text-gray-800">Original Size</div>
                          <div className="text-gray-600">{job.originalSize}</div>
                        </div>
                      )}
                      {job.processedSize && (
                        <div className="text-center p-2 bg-gray-50 rounded">
                          <div className="font-medium text-gray-800">Processed Size</div>
                          <div className="text-gray-600">{job.processedSize}</div>
                        </div>
                      )}
                      {job.result && calculateCompressionRatio(job) && (
                        <div className="text-center p-2 bg-gray-50 rounded">
                          <div className="font-medium text-gray-800">Compression</div>
                          <div className="text-gray-600">{calculateCompressionRatio(job)}</div>
                        </div>
                      )}
                      {job.result?.processingTime && (
                        <div className="text-center p-2 bg-gray-50 rounded">
                          <div className="font-medium text-gray-800">Processing Time</div>
                          <div className="text-gray-600">{job.result.processingTime}ms</div>
                        </div>
                      )}
                    </div>

                    {/* Image Dimensions */}
                    {job.result && (
                      <div className="mt-3 grid grid-cols-2 gap-4 text-sm">
                        <div className="text-center p-2 bg-blue-50 rounded">
                          <div className="font-medium text-blue-800">Dimensions</div>
                          <div className="text-blue-600">{job.result.width} × {job.result.height}px</div>
                        </div>
                        <div className="text-center p-2 bg-green-50 rounded">
                          <div className="font-medium text-green-800">Format</div>
                          <div className="text-green-600 uppercase">{job.result.format}</div>
                        </div>
                      </div>
                    )}

                    {/* Operations Applied */}
                    {job.operations && job.operations.length > 0 && (
                      <div className="mt-3">
                        <div className="font-medium text-gray-800 text-sm mb-2">Operations Applied:</div>
                        <div className="flex flex-wrap gap-1">
                          {job.operations.map((op, index) => (
                            <span
                              key={index}
                              className="px-2 py-1 bg-purple-100 text-purple-800 rounded text-xs font-medium"
                            >
                              {op}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Metadata */}
                    {job.result?.metadata && (
                      <div className="mt-3 text-xs text-gray-500">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                          <div>Channels: {job.result.metadata.channels}</div>
                          <div>Colorspace: {job.result.metadata.colorspace}</div>
                          <div>Alpha: {job.result.metadata.hasAlpha ? 'Yes' : 'No'}</div>
                          {job.result.metadata.density && (
                            <div>DPI: {job.result.metadata.density}</div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Error Message */}
                {(job.status === 'failed') && job.error && (
                  <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                    <div className="font-medium text-red-800 text-sm mb-1">Processing Failed</div>
                    <div className="text-red-700 text-sm">{job.error}</div>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex space-x-3">
                  {job.status === 'completed' && (
                    <button
                      onClick={() => onDownloadFile(job.jobId, job.filename)}
                      className="flex-1 bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 text-white px-4 py-3 rounded-lg font-semibold transition-all duration-200 text-center"
                    >
                      📥 Download Processed Image
                    </button>
                  )}
                  {(job.status === 'processing' || job.status === 'active' || job.status === 'waiting') && (
                    <button
                      onClick={() => onUpdateJobStatus(job.jobId)}
                      className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-4 py-3 rounded-lg font-semibold transition-colors"
                    >
                      🔄 Refresh Status
                    </button>
                  )}
                  {(job.status === 'failed') && (
                    <button
                      onClick={() => onRemoveJob(job.jobId)}
                      className="flex-1 bg-red-600 hover:bg-red-700 text-white px-4 py-3 rounded-lg font-semibold transition-colors"
                    >
                      🗑️ Remove Failed Job
                    </button>
                  )}
                  {job.status === 'pending' && (
                    <button
                      onClick={() => onUpdateJobStatus(job.jobId)}
                      className="flex-1 bg-yellow-600 hover:bg-yellow-700 text-white px-4 py-3 rounded-lg font-semibold transition-colors"
                    >
                      ⏱️ Check Queue Status
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default JobResults;