import { useState, useEffect, useCallback, useRef } from 'react'
import { check, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'installing'
  | 'error'

export interface UpdateInfo {
  version: string
  notes: string
}

export function useUpdater() {
  const [status, setStatus] = useState<UpdateStatus>('idle')
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [downloadProgress, setDownloadProgress] = useState(0)
  const updateRef = useRef<Update | null>(null)
  const checkingRef = useRef(false)

  const checkForUpdate = useCallback(async () => {
    if (checkingRef.current) return
    checkingRef.current = true

    try {
      setStatus('checking')
      const update = await check()

      if (update) {
        updateRef.current = update
        setUpdateInfo({
          version: update.version,
          notes: update.body || '',
        })
        setStatus('available')
      } else {
        setStatus('idle')
      }
    } catch (err) {
      console.error('[Updater] Check failed:', err)
      setStatus('idle')
    } finally {
      checkingRef.current = false
    }
  }, [])

  const downloadAndInstall = useCallback(async () => {
    try {
      // Re-check for a fresh Update object (handles retry after error)
      let update = updateRef.current
      if (!update) {
        const freshUpdate = await check()
        if (!freshUpdate) { setStatus('idle'); return }
        updateRef.current = freshUpdate
        update = freshUpdate
      }

      setStatus('downloading')
      setDownloadProgress(0)

      let totalLength = 0
      let downloadedLength = 0

      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case 'Started':
            totalLength = event.data.contentLength || 0
            break
          case 'Progress':
            downloadedLength += event.data.chunkLength
            if (totalLength > 0) {
              setDownloadProgress(Math.round((downloadedLength / totalLength) * 100))
            }
            break
          case 'Finished':
            setDownloadProgress(100)
            break
        }
      })

      setStatus('installing')
      await new Promise(resolve => setTimeout(resolve, 1000))
      await relaunch()
    } catch (err) {
      console.error('[Updater] Install failed:', err)
      // Clear stale ref so retry fetches a fresh Update
      updateRef.current = null
      setStatus('error')
    }
  }, [])

  const dismiss = useCallback(() => {
    setStatus('idle')
    setUpdateInfo(null)
  }, [])

  // Check on mount with 5s delay, then every 4 hours
  useEffect(() => {
    const timer = setTimeout(() => { checkForUpdate() }, 5000)
    const interval = setInterval(() => { checkForUpdate() }, 4 * 60 * 60 * 1000)
    return () => { clearTimeout(timer); clearInterval(interval) }
  }, [checkForUpdate])

  // Listen for manual check from Settings
  useEffect(() => {
    const handler = () => { checkForUpdate() }
    window.addEventListener('check-for-update', handler)
    return () => window.removeEventListener('check-for-update', handler)
  }, [checkForUpdate])

  return { status, updateInfo, downloadProgress, checkForUpdate, downloadAndInstall, dismiss }
}
