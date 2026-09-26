import { Handle, Position } from '@xyflow/react';
import { useState } from 'react';
import { GenControls, Media, Progress, Versions, useInputs, Thumb, Viewer, CloseButton } from './common.jsx';
import { IMAGE_MODELS } from '../models.js';

export default function ImageNode({ id, data, selected }) {
  const inputs = useInputs(id);
  const [viewer, setViewer] = useState(false);
  const model = IMAGE_MODELS[data.model];
  return (
    <div className={`node gen image ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Left} id="refs" title="Images de référence" />
      <CloseButton id={id} />
      <div className="node-title">Image {inputs.length > 0 && <span className="muted">· {inputs.length} réf.</span>}</div>
      {inputs.length > 0 && (
        <div className="inputs">
          {inputs.map((i, k) => <Thumb key={k} mediaId={i.mediaId} url={i.url} className={`ithumb ${k >= model.maxRefs ? 'over' : ''}`} />)}
        </div>
      )}
      <div className="preview" style={{ aspectRatio: data.ratio.replace(':', '/') }}>
        <Media version={data.versions[data.current]} kind="image" onOpen={() => setViewer(true)} />
        {data.versions.length > 0 && <button className="icon expand nodrag" title="Plein écran / comparer" onClick={() => setViewer(true)}>⛶</button>}
        <Progress tasks={data.tasks} />
      </div>
      {data.versions[data.current] && (
        <div className="vcaption">
          {data.versions[data.current].model}
          {data.versions[data.current].cost != null && ` · ${data.versions[data.current].cost} crédits`}
          {data.versions.length > 1 && ` · version ${data.current + 1}/${data.versions.length}`}
        </div>
      )}
      <Versions id={id} data={data} kind="image" />
      {viewer && <Viewer id={id} data={data} kind="image" onClose={() => setViewer(false)} />}
      <GenControls id={id} data={data} kind="image" inputs={inputs} roles={inputs.map((_, k) => `Image de référence ${k + 1}`)} />
      <Handle type="source" position={Position.Right} id="out" title="Image" />
    </div>
  );
}
