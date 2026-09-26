import { useRef, useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import { useMediaUrl, CloseButton } from './common.jsx';
import { patchActive } from '../store.js';
import { putMedia } from '../db.js';

export async function importFile(file) {
  return putMedia(file, { name: file.name });
}

export default function ImportNode({ id, data, selected }) {
  const src = useMediaUrl(data.mediaId);
  const input = useRef();
  const [over, setOver] = useState(false);

  const load = async (file) => {
    if (!file?.type.startsWith('image/')) return;
    patchActive(id, { mediaId: await importFile(file), name: file.name });
  };

  return (
    <div className={`node import ${selected ? 'selected' : ''}`}>
      <CloseButton id={id} />
      <div className="node-title">Import {data.name && <span className="muted">· {data.name}</span>}</div>
      <div
        className={`drop nodrag ${over ? 'over' : ''}`}
        onClick={() => input.current.click()}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setOver(false); load(e.dataTransfer.files[0]); }}
      >
        {src ? <img className="media" src={src} alt="" draggable={false} /> : <span>Glisse une image ici<br />ou clique</span>}
      </div>
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => load(e.target.files[0])} />
      <Handle type="source" position={Position.Right} id="out" title="Image" />
    </div>
  );
}
