import React, { useState } from "react";

const JobStatus: React.FC = () => {
  const [jobId, setJobId] = useState("");
  const [status, setStatus] = useState<any>(null);

  const checkStatus = async () => {
    const res = await fetch(
      `http://localhost:5000/upload/job/${jobId}/status`
    );
    const data = await res.json();
    setStatus(data);
  };

  const downloadFile = () => {
    if (status?.status === "completed" && status?.outputPath) {
      window.location.href = `http://localhost:5000/upload/job/${jobId}/download`;
    }
  };

  return (
    <div>
      <h2>Job Status</h2>
      <input
        type="text"
        placeholder="Enter Job ID"
        value={jobId}
        onChange={(e) => setJobId(e.target.value)}
      />
      <button onClick={checkStatus}>Check Status</button>

      {status && (
        <div>
          <pre>{JSON.stringify(status, null, 2)}</pre>
          {status.status === "completed" && (
            <button onClick={downloadFile}>Download Processed File</button>
          )}
        </div>
      )}
    </div>
  );
};

export default JobStatus;
