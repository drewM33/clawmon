import { useState, useRef, useCallback } from 'react';
import { Video, Upload } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { API_BASE } from '../config/env';
import AuthGate from './AuthGate';

interface DemoVideoUploadProps {
  agentId: string;
}

const MAX_FILE_SIZE_MB = 100;
const ACCEPTED_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
const ACCEPTED_EXTENSIONS = '.mp4,.webm,.mov';

function DemoVideoUploadInner({ agentId }: DemoVideoUploadProps) {
  const { address } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validateFile = useCallback((f: File): string | null => {
    if (!ACCEPTED_TYPES.includes(f.type)) {
      return `Unsupported format. Please upload MP4, WebM, or MOV.`;
    }
    if (f.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      return `File too large. Maximum size is ${MAX_FILE_SIZE_MB}MB.`;
    }
    return null;
  }, []);

  const handleFile = useCallback((f: File) => {
    setError(null);
    setSuccess(false);
    const validationError = validateFile(f);
    if (validationError) {
      setError(validationError);
      return;
    }
    setFile(f);
    const url = URL.createObjectURL(f);
    setPreviewUrl(url);
  }, [validateFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) handleFile(droppedFile);
  }, [handleFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) handleFile(selected);
  }, [handleFile]);

  const handleRemove = useCallback(() => {
    setFile(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setError(null);
    setSuccess(false);
    setProgress(0);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [previewUrl]);

  const handleUpload = useCallback(async () => {
    if (!file || !address) return;
    setUploading(true);
    setError(null);
    setProgress(0);

    try {
      const formData = new FormData();
      formData.append('video', file);
      formData.append('agentId', agentId);
      formData.append('uploaderAddress', address);

      const xhr = new XMLHttpRequest();

      await new Promise<void>((resolve, reject) => {
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            setProgress(Math.round((e.loaded / e.total) * 100));
          }
        });

        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            try {
              const data = JSON.parse(xhr.responseText);
              reject(new Error(data.error || 'Upload failed'));
            } catch {
              reject(new Error(`Upload failed (${xhr.status})`));
            }
          }
        });

        xhr.addEventListener('error', () => reject(new Error('Network error during upload')));
        xhr.addEventListener('abort', () => reject(new Error('Upload cancelled')));

        xhr.open('POST', `${API_BASE}/agents/${encodeURIComponent(agentId)}/demo-video`);
        xhr.send(formData);
      });

      setSuccess(true);
      setTimeout(() => setSuccess(false), 5000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }, [file, address, agentId]);

  const formatSize = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="demo-video-upload">
      <h3>Demo Video</h3>
      <p className="demo-video-hint">
        Upload a short video demonstrating this skill in action. Max {MAX_FILE_SIZE_MB}MB.
      </p>

      {!file ? (
        <div
          className={`demo-video-dropzone ${dragOver ? 'drag-over' : ''}`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="dropzone-icon">
            <Upload className="w-7 h-7" />
          </div>
          <span className="dropzone-text">
            Drag &amp; drop video or <span className="dropzone-link">browse</span>
          </span>
          <span className="dropzone-formats">MP4, WebM, or MOV</span>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_EXTENSIONS}
            onChange={handleInputChange}
            style={{ display: 'none' }}
          />
        </div>
      ) : (
        <div className="demo-video-preview">
          {previewUrl && (
            <video
              className="demo-video-player"
              src={previewUrl}
              controls
              preload="metadata"
            />
          )}
          <div className="demo-video-file-info">
            <div className="file-info-details">
              <span className="file-info-name">{file.name}</span>
              <span className="file-info-size">{formatSize(file.size)}</span>
            </div>
            <div className="demo-video-actions">
              {!uploading && !success && (
                <>
                  <button className="demo-video-btn upload" onClick={handleUpload}>
                    Upload
                  </button>
                  <button className="demo-video-btn remove" onClick={handleRemove}>
                    Remove
                  </button>
                </>
              )}
              {uploading && (
                <div className="demo-video-progress">
                  <div className="progress-bar-track">
                    <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
                  </div>
                  <span className="progress-label">{progress}%</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {success && <div className="feedback-success">Demo video uploaded successfully</div>}
      {error && <div className="feedback-error">{error}</div>}
    </div>
  );
}

export default function DemoVideoUpload(props: DemoVideoUploadProps) {
  return (
    <AuthGate
      fallback={
        <div className="demo-video-upload">
          <h3>Demo Video</h3>
          <div className="auth-gate-notice" style={{ margin: 0, padding: '20px' }}>
            <Video className="w-7 h-7" style={{ color: 'var(--accent)' }} />
            <h3>Connect Wallet to Upload</h3>
            <p>Connect your wallet to upload a demo video for this skill.</p>
          </div>
        </div>
      }
    >
      <DemoVideoUploadInner {...props} />
    </AuthGate>
  );
}
