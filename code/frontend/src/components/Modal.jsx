export default function Modal({ title, children, onClose, actions }) {
  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        {title && <h3>{title}</h3>}
        <div>{children}</div>
        {actions && <div className="modal-actions">{actions}</div>}
      </div>
    </div>
  );
}

export function ConfirmModal({ title, message, onConfirm, onClose, confirmLabel = 'Confirm', danger = false }) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      actions={
        <>
          <button onClick={onClose}>Cancel</button>
          <button className={danger ? 'danger' : 'primary'} onClick={onConfirm}>{confirmLabel}</button>
        </>
      }
    >
      <p>{message}</p>
    </Modal>
  );
}
