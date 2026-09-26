import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useShallow } from 'zustand/react/shallow';
import { getMedia } from '../db.js';
import { useStore, patchActive } from '../store.js';
import { modelsFor, defaultOpts, formatCost } from '../models.js';
import { runNode, upscaleNode, inputsOf, outputOf, costOf } from '../runner.js';
import { UPSCALE } from '../models.js';
import { askClaude, copyText } from '../claude.js';

const urlCache = new Map();

// URL affichable d'un média stocké dans IndexedDB.
export function useMediaUrl(mediaId, fallback) {
  const [url, setUrl] = useState(() => urlCache.get(mediaId) || null);
  useEffect(() => {
    if (!mediaId) return setUrl(null);
    if (urlCache.has(mediaId)) return setUrl(urlCache.get(mediaId));
    let alive = true;
    getMedia(mediaId).then((m) => {
      if (!m || !alive) return;
      const u = URL.createObjectURL(m.blob);
      urlCache.set(mediaId, u);
      setUrl(u);
    });
    return () => { alive = false; };
  }, [mediaId]);
  return url || fallback || null;
}

// Sorties des nœuds reliés en entrée, sous forme stable.
export function useInputs(nodeId) {
  const keys = useStore(useShallow((s) => {
    const b = s.boards[s.activeId];
    return b ? inputsOf(b, nodeId).map((n) => {
      const o = outputOf(n);
      return `${n.id}|${o?.mediaId || ''}|${o?.url || ''}`;
    }) : [];
  }));
  return keys.map((k) => {
    const [id, mediaId, url] = k.split('|');
    return { id, mediaId: mediaId || null, url: url || null };
  });
}

// Croix de fermeture en haut à droite d'un nœud.
export function CloseButton({ id }) {
  return (
    <button className="node-close nodrag" title="Fermer (supprimer ce nœud)" onClick={() => useStore.getState().removeNode(id)}>✕</button>
  );
}

export function Thumb({ mediaId, url, className }) {
  const src = useMediaUrl(mediaId, url);
  return src ? <img className={className} src={src} alt="" draggable={false} /> : <div className={`${className} empty`} />;
}

export function Media({ version, kind, onOpen }) {
  const src = useMediaUrl(version?.mediaId, version?.url);
  if (!src) return null;
  return kind === 'video'
    ? <video className="media" src={src} controls loop playsInline onDoubleClick={onOpen} />
    : <img className="media" src={src} alt="" draggable={false} onDoubleClick={onOpen} title="Double-clic : plein écran" />;
}

const STATUS = {
  upload: 'Envoi des images…', envoi: 'Envoi…', waiting: 'En attente…', queuing: 'En file d’attente…',
  generating: 'Génération…', download: 'Téléchargement…',
};

function Elapsed({ since }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.floor((Date.now() - since) / 1000);
  return <span>{Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}</span>;
}

export function Progress({ tasks }) {
  if (!tasks?.length) return null;
  const t = tasks[0];
  return (
    <div className="progress">
      <div className="progress-bar"><div /></div>
      <div className="progress-label">
        {t.label ? `${t.label} · ` : ''}{STATUS[t.status] || t.status} <Elapsed since={t.startedAt} />
        {tasks.length > 1 && <span>· {tasks.length} en cours</span>}
      </div>
    </div>
  );
}

export function Versions({ id, data, kind }) {
  if (!data.versions.length) return null;
  return (
    <div className="versions nodrag nowheel">
      {data.versions.map((v, i) => (
        <button
          key={i}
          className={i === data.current ? 'on' : ''}
          title={`${v.label ? `${v.label} · ` : ''}${v.model} — ${new Date(v.createdAt).toLocaleString()}\n${v.prompt}`}
          onClick={() => patchActive(id, { current: i, ...(v.prompt && { prompt: v.prompt }) })}
        >
          {kind === 'video' ? <span className="vnum">{i + 1}</span> : <Thumb mediaId={v.mediaId} url={v.url} className="vthumb" />}
          {v.label === 'Upscale 4K' && <span className="vbadge">4K</span>}
          <span
            className="vclose"
            title="Retirer cette version"
            onClick={(e) => { e.stopPropagation(); useStore.getState().removeVersion(id, i); }}
          >✕</span>
        </button>
      ))}
    </div>
  );
}

function ViewerMedia({ version, kind }) {
  const src = useMediaUrl(version?.mediaId, version?.url);
  if (!src) return <div className="viewer-empty" />;
  return kind === 'video'
    ? <video src={src} controls loop autoPlay playsInline />
    : <img src={src} alt="" draggable={false} />;
}

// Plein écran : parcourir les versions (← →) ou en comparer deux côte à côte.
export function Viewer({ id, data, kind, onClose }) {
  const n = data.versions.length;
  const [a, setA] = useState(Math.max(0, data.current));
  const [b, setB] = useState(null); // null = une seule image
  const move = (d) => (b === null ? setA((i) => (i + d + n) % n) : setB((i) => (i + d + n) % n));

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') move(1);
      if (e.key === 'ArrowLeft') move(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const info = (v, i) => `${i + 1}/${n}${v.label ? ` · ${v.label}` : ''} · ${v.model}`;
  const keep = (i) => { const p = data.versions[i].prompt; patchActive(id, { current: i, ...(p && { prompt: p }) }); onClose(); };

  return createPortal(
    <div className="viewer" onClick={onClose}>
      <div className="viewer-bar" onClick={(e) => e.stopPropagation()}>
        <button onClick={() => setB(b === null ? (a + 1) % n : null)} disabled={n < 2}>
          {b === null ? 'Comparer' : 'Vue simple'}
        </button>
        <span className="muted">← → pour naviguer · Échap pour fermer</span>
        <button className="icon" onClick={onClose}>✕</button>
      </div>
      <div className={`viewer-main ${b !== null ? 'split' : ''}`} onClick={(e) => e.stopPropagation()}>
        {[a, b].filter((i) => i !== null).map((i, k) => (
          <figure key={k}>
            <ViewerMedia version={data.versions[i]} kind={kind} />
            <figcaption>
              <span>{info(data.versions[i], i)}</span>
              <button className="primary" onClick={() => keep(i)}>Garder celle-ci</button>
            </figcaption>
          </figure>
        ))}
      </div>
      <div className="viewer-strip" onClick={(e) => e.stopPropagation()}>
        {data.versions.map((v, i) => (
          <button
            key={i}
            className={i === a ? 'on' : i === b ? 'on-b' : ''}
            onClick={() => (b === null ? setA(i) : setB(i))}
            title={v.prompt}
          >
            {kind === 'video' ? <span className="vnum">{i + 1}</span> : <Thumb mediaId={v.mediaId} url={v.url} className="vthumb" />}
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}

// Assistant de prompt : Claude réécrit le prompt à partir de la consigne et des images reliées.
function ClaudePanel({ id, data, kind, modelLabel, inputs, roles, onClose }) {
  const anthropicKey = useStore((s) => s.anthropicKey);
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [previous, setPrevious] = useState(null);

  const [copied, setCopied] = useState(false);
  const version = data.versions[data.current];
  const images = inputs.map((i, k) => ({ ...i, role: roles[k] }));
  if (version && kind === 'image') images.push({ ...version, role: 'Résultat actuel du nœud' });

  const setPrompt = (prompt) => {
    setPrevious(data.prompt);
    patchActive(id, { prompt });
  };

  const ask = async () => {
    setBusy(true);
    setError(null);
    try {
      const prompt = await askClaude({
        apiKey: anthropicKey, kind, modelLabel, prompt: data.prompt, instruction, images,
      });
      setPrompt(prompt);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="claude nodrag">
      <textarea
        className="nowheel"
        rows={2}
        placeholder="Ta demande (facultatif) : « plus cinématique », « nuit sous la pluie », « écris-le en partant des images »…"
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) ask(); }}
      />
      <div className="row">
        <button className="primary" onClick={ask} disabled={busy}>{busy ? 'Claude écrit…' : '✨ Réécrire le prompt'}</button>
        {previous !== null && !busy && (
          <button onClick={() => { patchActive(id, { prompt: previous }); setPrevious(null); }}>↶ Annuler</button>
        )}
        <span className="spacer" />
        <button className="icon" title="Fermer" onClick={onClose}>✕</button>
      </div>
      <div className="muted small">{anthropicKey ? 'Via l’API Anthropic' : 'Via Claude Code (ton abonnement)'}</div>
      {error && (
        <div className="error">
          {error}
          <div className="row manual">
            <span>Sinon, en passant par le chat claude.ai :</span>
            <button onClick={async () => {
              await navigator.clipboard.writeText(copyText({ kind, modelLabel, prompt: data.prompt, instruction, roles: images.map((i) => i.role) }));
              setCopied(true);
            }}>{copied ? '✓ Copié' : '📋 Copier la demande'}</button>
            <button onClick={async () => {
              const text = (await navigator.clipboard.readText()).trim();
              if (text) { setPrompt(text); setError(null); }
            }}>📥 Coller la réponse</button>
          </div>
        </div>
      )}
    </div>
  );
}

// Prompt, Claude, modèle, format, options, variantes, coût et boutons.
export function GenControls({ id, data, kind, hideRatio, inputs = [], roles = [] }) {
  const models = modelsFor(kind);
  const model = models[data.model];
  const opts = defaultOpts(model, data.opts);
  const ratio = model.ratios?.includes(data.ratio) ? data.ratio : model.defaultRatio || model.ratios?.[0];
  const set = (p) => patchActive(id, p);
  const version = data.versions[data.current];
  const src = useMediaUrl(version?.mediaId, version?.url);
  const [showExtra, setShowExtra] = useState(!!data.extra);
  const [showClaude, setShowClaude] = useState(false);
  const boardId = () => useStore.getState().activeId;

  return (
    <div className="controls">
      <div className="prompt-wrap">
        <textarea
          className="nodrag nowheel prompt"
          placeholder="Prompt…"
          value={data.prompt}
          onChange={(e) => set({ prompt: e.target.value })}
          rows={3}
        />
        <button
          className={`claude-btn nodrag ${showClaude ? 'on' : ''}`}
          title="Demander à Claude d'écrire ou d'améliorer le prompt"
          onClick={() => setShowClaude(!showClaude)}
        >✨</button>
      </div>
      {showClaude && (
        <ClaudePanel
          id={id} data={data} kind={kind} modelLabel={model.label}
          inputs={inputs} roles={roles} onClose={() => setShowClaude(false)}
        />
      )}
      <div className="row nodrag">
        <select value={data.model} onChange={(e) => {
          const m = models[e.target.value];
          set({ model: e.target.value, ...(m.ratios && !m.ratios.includes(data.ratio) && { ratio: m.defaultRatio || m.ratios[0] }) });
        }}>
          {Object.entries(models).filter(([, m]) => !m.other).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
          <optgroup label="Autres modèles">
            {Object.entries(models).filter(([, m]) => m.other).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
          </optgroup>
        </select>
        {model.ratios && !hideRatio && (
          <select value={ratio} onChange={(e) => set({ ratio: e.target.value })} title="Format">
            {model.ratios.map((r) => <option key={r}>{r}</option>)}
          </select>
        )}
        {Object.entries(model.options).map(([k, vals]) => (
          <select key={k} value={opts[k]} title={k} onChange={(e) => set({ opts: { ...opts, [k]: e.target.value } })}>
            {vals.map((v) => <option key={v} value={v}>{k === 'duration' ? `${v}s` : v}</option>)}
          </select>
        ))}
        <select value={data.count || 1} title="Nombre de variantes" onChange={(e) => set({ count: Number(e.target.value) })}>
          {[1, 2, 3, 4].map((c) => <option key={c} value={c}>×{c}</option>)}
        </select>
      </div>
      {showExtra && (
        <textarea
          className="nodrag nowheel extra"
          placeholder='Paramètres KIE en plus (JSON), ex. {"seed": 42}'
          value={data.extra}
          onChange={(e) => set({ extra: e.target.value })}
          rows={2}
        />
      )}
      <div className="row nodrag actions">
        <span className="cost">{formatCost(costOf(kind, data))}</span>
        <button className="icon" title="Paramètres avancés" onClick={() => setShowExtra(!showExtra)}>⋯</button>
        {src && kind === 'image' && (
          <button className="icon" title={`Upscale 4K avec Nano Banana Pro (${formatCost(UPSCALE.cost)})`} onClick={() => upscaleNode(boardId(), id)}>4K</button>
        )}
        {src && <a className="btn icon" href={src} download={`${kind}-${id.slice(0, 6)}-${data.current + 1}`} title="Télécharger">⬇</a>}
        <button className="icon" title="Dupliquer" onClick={() => useStore.getState().duplicateNode(id)}>⧉</button>
        <button className="primary icon" title="Générer" onClick={() => runNode(boardId(), id)}>▶</button>
      </div>
      {data.error && (
        <div className="error nodrag">
          {data.error}
          {data.lastRequest && (
            <details>
              <summary>Requête envoyée</summary>
              <pre className="nowheel">{JSON.stringify(data.lastRequest, null, 2)}</pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
