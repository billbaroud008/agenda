import { useEffect, useRef, useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useStore } from './store.js';
import { exportBoards, importFile } from './io.js';
import { getCredits } from './kie.js';
import { getSetting } from './db.js';

const WEEK = 7 * 86400000;

function Settings({ onClose }) {
  const apiKey = useStore((s) => s.apiKey);
  const [key, setKey] = useState(apiKey);
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Réglages</h3>
        <label>
          Clé API KIE.ai
          <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-…" autoFocus />
        </label>
        <p className="muted small">
          Récupère-la sur <a href="https://kie.ai/api-key" target="_blank" rel="noreferrer">kie.ai/api-key</a>.
          Elle reste stockée dans ce navigateur uniquement.
        </p>
        <div className="row end">
          <button onClick={onClose}>Annuler</button>
          <button className="primary" onClick={() => { useStore.getState().setApiKey(key.trim()); onClose(); }}>Enregistrer</button>
        </div>
      </div>
    </div>
  );
}

export default function Toolbar() {
  const boards = useStore((s) => s.boards);
  const activeId = useStore((s) => s.activeId);
  const apiKey = useStore((s) => s.apiKey);
  const store = useStore.getState();
  const rf = useReactFlow();
  const fileInput = useRef();
  const [settings, setSettings] = useState(!apiKey);
  const [credits, setCredits] = useState(null);
  const [lastExport, setLastExport] = useState(null);

  const refreshCredits = () => apiKey && getCredits(apiKey).then(setCredits).catch(() => setCredits('?'));
  useEffect(() => { refreshCredits(); }, [apiKey]);
  useEffect(() => { getSetting('lastExport').then((t) => setLastExport(t || 0)); }, []);

  const sorted = Object.values(boards).sort((a, b) => a.createdAt - b.createdAt);
  const board = boards[activeId];

  const add = (type) => {
    const { x, y } = rf.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    // Décale vers la droite tant que la place est prise.
    const pos = { x: x - 150, y: y - 150 };
    const taken = (p) => board.nodes.some((n) =>
      Math.abs(n.position.x - p.x) < (n.measured?.width || 300) && Math.abs(n.position.y - p.y) < 200);
    while (taken(pos)) pos.x += 60;
    store.addNode(type, pos);
  };

  const doExport = async (ids) => {
    await exportBoards(ids);
    setLastExport(Date.now());
  };

  const doImport = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const n = await importFile(f);
      alert(`${n} board(s) importé(s).`);
    } catch (err) {
      alert(`Import impossible : ${err.message}`);
    }
  };

  const oldExport = lastExport !== null && Date.now() - lastExport > WEEK && board.nodes.length > 0;

  return (
    <header className="toolbar">
      <strong className="brand">Canvas IA</strong>
      <select value={activeId} onChange={(e) => store.setActive(e.target.value)} title="Board">
        {sorted.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select>
      <button title="Nouveau board" onClick={() => { const n = prompt('Nom du board', `Projet ${sorted.length + 1}`); if (n) store.createBoard(n); }}>＋</button>
      <button title="Renommer" onClick={() => { const n = prompt('Nouveau nom', board.name); if (n) store.renameBoard(activeId, n); }}>✎</button>
      <button title="Supprimer le board" onClick={() => confirm(`Supprimer « ${board.name} » et ses médias ?`) && store.deleteBoard(activeId)}>🗑</button>

      <span className="sep" />
      <button onClick={() => add('image')}>＋ Image</button>
      <button onClick={() => add('import')}>＋ Import</button>
      <button onClick={() => add('video')}>＋ Vidéo</button>
      <button onClick={() => add('note')}>＋ Note</button>

      <span className="spacer" />
      <button className={oldExport ? 'warn' : ''} title={oldExport ? 'Pas d’export depuis plus de 7 jours' : 'Exporter ce board en .json'} onClick={() => doExport([activeId])}>Exporter</button>
      <button title="Exporter tous les boards" onClick={() => doExport(sorted.map((b) => b.id))}>Tout exporter</button>
      <button onClick={() => fileInput.current.click()}>Importer</button>
      <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={doImport} />

      <span className="sep" />
      {apiKey && <button className="ghost" title="Solde KIE (cliquer pour actualiser)" onClick={refreshCredits}>{credits ?? '…'} crédits</button>}
      <button title="Réglages" onClick={() => setSettings(true)}>⚙</button>
      {settings && <Settings onClose={() => setSettings(false)} />}
    </header>
  );
}
