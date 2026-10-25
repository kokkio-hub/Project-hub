import { useRef, useState } from 'react';
import { Download, File as FileIcon, FileText, Image as ImageIcon, Paperclip, Trash2, Upload } from 'lucide-react';
import type { Attachment, User } from '../../../shared/types';
import { errorMessage } from '../../api/client';
import { attachmentUrl, useAttachments, useDeleteAttachment, useUploadAttachment } from '../../api/board';
import { useAppStatus } from '../../api/queries';
import { Spinner, useConfirm, useToast } from '../../components/Feedback';
import { formatDateTime } from '../../lib/format';
import { currentLocale, t } from '../../i18n';

export function formatBytes(bytes: number): string {
  const one = (n: number) => n.toLocaleString(currentLocale(), { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${one(bytes / 1024 / 1024)} MB`;
  return `${one(bytes / 1024 / 1024 / 1024)} GB`;
}

function iconFor(a: Attachment) {
  if (a.isImage || a.mimeType.startsWith('image/')) return <ImageIcon size={16} aria-hidden />;
  if (a.mimeType === 'application/pdf' || a.mimeType.startsWith('text/')) return <FileText size={16} aria-hidden />;
  return <FileIcon size={16} aria-hidden />;
}

/**
 * Files on a task: drop them on the section, paste a screenshot, or pick them.
 * Images show as previews; everything else downloads.
 */
export function Attachments({
  taskId,
  readOnly,
  usersById,
  canDelete,
}: {
  taskId: number;
  readOnly: boolean;
  usersById: Map<number, User>;
  canDelete: (a: Attachment) => boolean;
}) {
  const { data: attachments, isPending } = useAttachments(taskId);
  const upload = useUploadAttachment(taskId);
  const remove = useDeleteAttachment(taskId);
  const toast = useToast();
  const confirm = useConfirm();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(0);
  const limit = useAppStatus().data?.uploadLimitBytes;

  const send = async (files: File[]) => {
    for (const file of files) {
      if (limit && file.size > limit) {
        toast.error(t('“{name}” is too big. Files can be at most {size}.', { name: file.name, size: formatBytes(limit) }));
        continue;
      }
      setUploading((n) => n + 1);
      try {
        await upload.mutateAsync(file);
      } catch (error) {
        toast.error(t('Couldn’t upload “{name}”: {error}', { name: file.name, error: errorMessage(error) }));
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };

  const del = async (a: Attachment) => {
    const ok = await confirm({ title: t('Remove this file?'), message: t('“{filename}” will be deleted.', { filename: a.filename }), confirmLabel: t('Remove'), danger: true });
    if (ok) remove.mutate(a.id, { onError: (e) => toast.error(errorMessage(e)) });
  };

  const images = (attachments ?? []).filter((a) => a.isImage);
  const others = (attachments ?? []).filter((a) => !a.isImage);
  const count = attachments?.length ?? 0;
  if (readOnly && count === 0) return null;

  return (
    <section
      className={`drawer-section attachments ${dragging ? 'is-dragging' : ''}`}
      onDragOver={(e) => {
        if (readOnly || !e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={(e) => {
        if (readOnly) return;
        e.preventDefault();
        setDragging(false);
        void send([...e.dataTransfer.files]);
      }}
      onPaste={(e) => {
        if (readOnly) return;
        const files = [...e.clipboardData.files];
        if (files.length > 0) {
          e.preventDefault();
          void send(files);
        }
      }}
    >
      <h3 className="section-title">
        {t('Files')} {count > 0 && <span className="muted">{count}</span>}
        {uploading > 0 && <Spinner size={14} />}
      </h3>
      {isPending ? (
        <Spinner />
      ) : (
        <>
          {images.length > 0 && (
            <ul className="thumbs">
              {images.map((a) => (
                <li key={a.id} className="thumb">
                  <a href={attachmentUrl(a.id)} target="_blank" rel="noreferrer" title={a.filename}>
                    <img src={attachmentUrl(a.id)} alt={a.filename} loading="lazy" />
                  </a>
                  {canDelete(a) && !readOnly && (
                    <button type="button" className="icon-btn icon-btn-sm thumb-remove" onClick={() => void del(a)} aria-label={t('Remove {filename}', { filename: a.filename })}>
                      <Trash2 size={13} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {others.length > 0 && (
            <ul className="files">
              {others.map((a) => {
                const by = a.userId ? usersById.get(a.userId)?.name : undefined;
                return (
                  <li key={a.id} className="file-row">
                    {iconFor(a)}
                    <a href={attachmentUrl(a.id, true)} className="file-name truncate" download>
                      {a.filename}
                    </a>
                    <span className="muted file-meta" title={formatDateTime(a.createdAt)}>
                      {formatBytes(a.size)}
                      {by ? ` · ${by}` : ''}
                    </span>
                    <a href={attachmentUrl(a.id, true)} className="icon-btn icon-btn-sm" aria-label={t('Download {filename}', { filename: a.filename })} download>
                      <Download size={13} />
                    </a>
                    {canDelete(a) && !readOnly && (
                      <button type="button" className="icon-btn icon-btn-sm" onClick={() => void del(a)} aria-label={t('Remove {filename}', { filename: a.filename })}>
                        <Trash2 size={13} />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
      {!readOnly && (
        <div className="dropzone">
          <Paperclip size={14} aria-hidden />
          <span>{t('Drop files here, paste a screenshot, or')}</span>
          <button type="button" className="link-button" onClick={() => input.current?.click()}>
            <Upload size={13} aria-hidden /> {t('choose files')}
          </button>
          <input
            ref={input}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              void send([...(e.target.files ?? [])]);
              e.target.value = '';
            }}
          />
        </div>
      )}
    </section>
  );
}
