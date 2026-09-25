import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { getMedia } from '../db.js';
import { useStore, patchActive } from '../store.js';
import { modelsFor, defaultOpts, formatCost } from '../models.js';
import { runNode, inputsOf, outputOf, costOf } from '../runner.js';

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

export function Thumb({ mediaId, url, className }) {
  const src = useMediaUrl(mediaId, url);
  return src ? <img className={className} src={src} alt="" draggable={false} /> : <div className={`${className} empty`} />;
}

export function Media({ version, kind }) {
  const src = useMediaUrl(version?.mediaId, version?.url);
  if (!src) return null;
  return kind === 'video'
    ? <video className="media" src={src} controls loop playsInline />
    : <img className="media" src={src} alt="" draggable={false} />;
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

export function Progress({ task }) {
  if (!task) return null;
  return (
    <div className="progress">
      <div className="progress-bar"><div /></div>
      <div className="progress-label">{STATUS[task.status] || task.status} <Elapsed since={task.startedAt} /></div>
    </div>
  );
}

export function Versions({ id, data, kind }) {
  if (data.versions.length < 2) return null;
  return (
    <div className="versions nodrag nowheel">
      {data.versions.map((v, i) => (
        <button
          key={i}
          className={i === data.current ? 'on' : ''}
          title={`${v.model} — ${new Date(v.createdAt).toLocaleString()}\n${v.prompt}`}
          onClick={() => patchActive(id, { current: i })}
        >
          {kind === 'video' ? <span className="vnum">{i + 1}</span> : <Thumb mediaId={v.mediaId} url={v.url} className="vthumb" />}
        </button>
      ))}
    </div>
  );
}

// Prompt, modèle, format, options, coût et boutons ▶ ⧉ ⬇.
export function GenControls({ id, data, kind, hideRatio }) {
  const models = modelsFor(kind);
  const model = models[data.model];
  const opts = defaultOpts(model, data.opts);
  const set = (p) => patchActive(id, p);
  const version = data.versions[data.current];
  const src = useMediaUrl(version?.mediaId, version?.url);
  const busy = !!data.task;
  const [showExtra, setShowExtra] = useState(!!data.extra);

  return (
    <div className="controls">
      <textarea
        className="nodrag nowheel prompt"
        placeholder="Prompt…"
        value={data.prompt}
        onChange={(e) => set({ prompt: e.target.value })}
        rows={3}
      />
      <div className="row nodrag">
        <select value={data.model} onChange={(e) => set({ model: e.target.value })}>
          {Object.entries(models).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
        </select>
        {model.ratios && !hideRatio && (
          <select value={data.ratio} onChange={(e) => set({ ratio: e.target.value })} title="Format">
            {model.ratios.map((r) => <option key={r}>{r}</option>)}
          </select>
        )}
        {Object.entries(model.options).map(([k, vals]) => (
          <select key={k} value={opts[k]} title={k} onChange={(e) => set({ opts: { ...opts, [k]: e.target.value } })}>
            {vals.map((v) => <option key={v} value={v}>{k === 'duration' ? `${v}s` : v}</option>)}
          </select>
        ))}
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
        {src && <a className="btn icon" href={src} download={`${kind}-${id.slice(0, 6)}-${data.current + 1}`} title="Télécharger">⬇</a>}
        <button className="icon" title="Dupliquer" onClick={() => useStore.getState().duplicateNode(id)}>⧉</button>
        <button className="primary icon" title="Générer" disabled={busy} onClick={() => runNode(useStore.getState().activeId, id)}>▶</button>
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
