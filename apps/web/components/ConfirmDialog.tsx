"use client";

import { useEffect, useRef, useState } from "react";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  requireText?: boolean;
  onCancel: () => void;
  onConfirm: (text: string) => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  requireText = false,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState("");

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
    if (!open) setText("");
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="app-dialog"
      aria-labelledby="confirm-title"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      onClose={onCancel}
    >
      <h2 id="confirm-title">{title}</h2>
      <p>{description}</p>
      {requireText && (
        <label>
          Reason
          <textarea
            autoFocus
            rows={3}
            value={text}
            minLength={3}
            onChange={(event) => setText(event.target.value)}
          />
        </label>
      )}
      <div className="dialog-actions">
        <button type="button" className="secondary-btn" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="danger-btn"
          disabled={requireText && text.trim().length < 3}
          onClick={() => onConfirm(text.trim())}
        >
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
