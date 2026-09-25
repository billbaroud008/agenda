import { Handle, Position } from '@xyflow/react';
import { GenControls, Media, Progress, Versions, useInputs, Thumb } from './common.jsx';
import { VIDEO_MODELS } from '../models.js';
import { useStore } from '../store.js';

// Inverse l'ordre des images reliées (premier ⇄ dernier frame).
function swapInputs(nodeId) {
  const s = useStore.getState();
  s.updateBoard(s.activeId, (b) => {
    const mine = b.edges.filter((e) => e.target === nodeId).reverse();
    let i = 0;
    return { edges: b.edges.map((e) => (e.target === nodeId ? mine[i++] : e)) };
  });
}

export default function VideoNode({ id, data, selected }) {
  const inputs = useInputs(id);
  const model = VIDEO_MODELS[data.model];
  const ratio = inputs.length || !model.ratios ? '16/9' : data.ratio.replace(':', '/');
  return (
    <div className={`node gen video ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Left} id="images" title="Images" />
      <div className="node-title">Vidéo <span className="muted">· {inputs.length ? 'image → vidéo' : 'texte → vidéo'}</span></div>
      {inputs.length > 0 && (
        <div className="inputs roles">
          {inputs.map((i, k) => (
            <figure key={k} className={k >= model.maxImages ? 'over' : ''}>
              <Thumb mediaId={i.mediaId} url={i.url} className="ithumb" />
              <figcaption>{model.imageRoles[k] || 'ignorée'}</figcaption>
            </figure>
          ))}
          {inputs.length === 2 && <button className="icon nodrag" title="Inverser" onClick={() => swapInputs(id)}>⇄</button>}
        </div>
      )}
      <div className="preview" style={{ aspectRatio: ratio }}>
        <Media version={data.versions[data.current]} kind="video" />
        <Progress task={data.task} />
      </div>
      <Versions id={id} data={data} kind="video" />
      <GenControls id={id} data={data} kind="video" hideRatio={inputs.length > 0} />
    </div>
  );
}
