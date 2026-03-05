import { useState, useEffect, useRef } from 'react'
import { Download, X, Loader2, RefreshCw, ArrowUpCircle, AlertCircle } from 'lucide-react'
import type { UpdateStatus, UpdateInfo } from '../hooks/useUpdater'

interface UpdateNotificationProps {
  status: UpdateStatus
  updateInfo: UpdateInfo | null
  downloadProgress: number
  onDownload: () => void
  onDismiss: () => void
}

export function UpdateNotification({
  status,
  updateInfo,
  downloadProgress,
  onDownload,
  onDismiss,
}: UpdateNotificationProps) {
  const isVisible = status === 'available' || status === 'downloading' || status === 'installing' || status === 'error'

  // Track whether we've already animated in to avoid replay on status transitions
  const [hasAnimated, setHasAnimated] = useState(false)
  const wasVisible = useRef(false)

  useEffect(() => {
    if (isVisible && !wasVisible.current) {
      setHasAnimated(false)
      // Trigger animation on next frame
      requestAnimationFrame(() => setHasAnimated(true))
    }
    if (!isVisible) {
      setHasAnimated(false)
    }
    wasVisible.current = isVisible
  }, [isVisible])

  if (!isVisible) return null

  const displayVersion = updateInfo?.version?.replace(/^v/, '') || ''

  return (
    <div
      className="fixed bottom-6 right-6 z-50 w-80"
      style={{
        animation: hasAnimated ? 'none' : 'slideUp 0.3s ease-out forwards',
        opacity: hasAnimated ? 1 : undefined,
      }}
    >
      <div
        className="rounded-xl p-4 shadow-lg"
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border-default)",
          backdropFilter: "blur(8px)",
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div
              className="flex h-8 w-8 items-center justify-center rounded-lg"
              style={{
                background: status === 'error'
                  ? "color-mix(in srgb, var(--status-error) 10%, transparent)"
                  : "var(--accent-subtle)",
              }}
            >
              {status === 'error'
                ? <AlertCircle size={16} style={{ color: "var(--status-error)" }} />
                : <ArrowUpCircle size={16} style={{ color: "var(--accent)" }} />
              }
            </div>
            <div>
              <p className="text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>
                {status === 'error' ? 'Update Failed' : 'Update Available'}
              </p>
              {displayVersion && (
                <p className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>v{displayVersion}</p>
              )}
            </div>
          </div>
          {(status === 'available' || status === 'error') && (
            <button
              onClick={onDismiss}
              className="rounded-md p-1 cursor-pointer"
              style={{ color: "var(--text-tertiary)" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text-secondary)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-tertiary)"; }}
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className="mt-3">
          {status === 'available' && (
            <button
              onClick={onDownload}
              className="flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-[13px] font-medium cursor-pointer"
              style={{ background: "var(--accent)", color: "white" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--accent-hover)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "var(--accent)"; }}
            >
              <Download size={14} />
              Download & Install
            </button>
          )}

          {status === 'downloading' && (
            <div>
              <div className="flex items-center gap-2 text-[12px]" style={{ color: "var(--text-tertiary)" }}>
                <Loader2 size={14} className="animate-spin" />
                <span>Downloading... {downloadProgress}%</span>
              </div>
              <div
                className="mt-2 h-1.5 w-full overflow-hidden rounded-full"
                style={{ background: "var(--bg-inset)" }}
              >
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{ width: `${downloadProgress}%`, background: "var(--accent)" }}
                />
              </div>
            </div>
          )}

          {status === 'installing' && (
            <div className="flex items-center gap-2 text-[12px]" style={{ color: "var(--text-tertiary)" }}>
              <RefreshCw size={14} className="animate-spin" />
              <span>Installing... Restarting shortly</span>
            </div>
          )}

          {status === 'error' && (
            <button
              onClick={onDownload}
              className="flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-[13px] font-medium cursor-pointer"
              style={{ background: "var(--accent)", color: "white" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--accent-hover)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "var(--accent)"; }}
            >
              <RefreshCw size={14} />
              Retry
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
