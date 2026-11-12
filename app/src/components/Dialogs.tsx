import { useEffect, useRef, useState, type ReactNode } from "react";
import { checkPin, useUi } from "../store/ui";
import { Icon } from "./Icon";

export function Modal({ title, children, onClose, wide }: { title: string; children: ReactNode; onClose?: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const first = ref.current?.querySelector<HTMLElement>("input, button, select, textarea");
    first?.focus();
  }, []);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${wide ? "modal-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title} data-modal ref={ref}>
        <header>
          <h2>{title}</h2>
          {onClose && (
            <button className="icon-btn" onClick={onClose} title="Fermer">
              <Icon name="close" />
            </button>
          )}
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

/** Saisie du code parental (pavé numérique utilisable à la télécommande). */
export function PinDialog() {
  const req = useUi((s) => s.pin);
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  useEffect(() => {
    setPin("");
    setError(false);
  }, [req]);
  if (!req) return null;

  const close = (ok: boolean) => {
    useUi.setState({ pin: null });
    req.resolve(ok);
  };
  const submit = async (value = pin) => {
    if (await checkPin(value)) close(true);
    else {
      setError(true);
      setPin("");
    }
  };
  const press = (d: string) => {
    const v = (pin + d).slice(0, 8);
    setPin(v);
    setError(false);
  };

  return (
    <Modal title={req.title} onClose={() => close(false)}>
      {req.message && <p className="dim">{req.message}</p>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          className={`pin-input ${error ? "shake" : ""}`}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
          placeholder="••••"
          aria-label="Code parental"
        />
        {error && <p className="error-text">Code incorrect.</p>}
        <div className="pinpad">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "OK"].map((k) => (
            <button
              type="button"
              key={k}
              className={`btn ${k === "OK" ? "btn-primary" : ""}`}
              onClick={() => (k === "⌫" ? setPin(pin.slice(0, -1)) : k === "OK" ? submit() : press(k))}
            >
              {k}
            </button>
          ))}
        </div>
      </form>
    </Modal>
  );
}

export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.tone}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
