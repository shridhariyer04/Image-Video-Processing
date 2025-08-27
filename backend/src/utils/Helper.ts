function generateRecommendations(diagnosis: any): string[] {
  const recommendations: string[] = [];
  
  if (!diagnosis.redisConnection) {
    recommendations.push('❌ Redis connection failed - check Redis server');
  }
  
  if (diagnosis.workerStatus !== 'running') {
    recommendations.push('❌ Worker not running - restart the worker');
  }
  
  if (diagnosis.stalledJobs.length > 0) {
    recommendations.push(`⚠️ ${diagnosis.stalledJobs.length} stalled jobs detected - consider restarting worker`);
  }
  
  if (diagnosis.queueCounts.waiting > 10) {
    recommendations.push('⚠️ High number of waiting jobs - check worker capacity');
  }
  
  if (diagnosis.queueCounts.failed > 5) {
    recommendations.push('⚠️ Multiple failed jobs - check error logs');
  }
  
  if (diagnosis.oldestWaitingJob && diagnosis.oldestWaitingJob.age > 10 * 60 * 1000) {
    recommendations.push('⚠️ Old jobs in queue - consider force processing');
  }
  
  if (recommendations.length === 0) {
    recommendations.push('✅ Queue appears healthy');
  }
  
  return recommendations;
}

export {generateRecommendations}