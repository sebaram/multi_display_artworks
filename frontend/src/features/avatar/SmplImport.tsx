import { useEffect, useRef, useState } from 'react';
import { parseSmplMotion, SMPL_MAX_BYTES, type SmplMotionClip } from '../../avatar/smpl';

export function SmplImport({ clip, onImport }: { clip?: SmplMotionClip; onImport(clip: SmplMotionClip): void }) {
  const [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, []);
  async function load(read: () => Promise<string>) {
    const request = ++generation.current;
    setLoading(true); setError('');
    try {
      const parsed = parseSmplMotion(await read());
      if (request === generation.current) onImport(parsed);
    } catch (reason) { if (request === generation.current) setError((reason as Error).message); }
    finally { if (request === generation.current) setLoading(false); }
  }
  return <section aria-label="SMPL motion import" style={{ margin: '14px 0', padding: 12, border: '1px solid #607080', borderRadius: 8 }}>
    <strong>SMPL / SMPL-X body motion</strong>
    <p>Private preview until Apply. Motion stays in this tab; only body poses are shared. File trajectories never move your camera. Entering XR stops imported motion.</p>
    <label>Local SMPL motion JSON <input aria-label="Local SMPL motion JSON" type="file" accept=".json,application/json" disabled={loading}
      onChange={event => {
        const file = event.target.files?.[0]; event.target.value = '';
        if (file) void load(async () => { if (file.size > SMPL_MAX_BYTES) throw Error('Motion file exceeds 8 MiB.'); return file.text(); });
      }} /></label>
    <button type="button" disabled={loading} style={{ color: '#17232f', marginTop: 8 }} onClick={() => void load(async () => {
      const response = await fetch('/avatars/smpl-synthetic-example.json');
      if (!response.ok) throw Error('Example could not load. Try again.');
      return response.text();
    })}>{loading ? 'Loading motion…' : 'Load synthetic example'}</button>
    <p>Synthetic example: self-authored compatible parameters, not captured human movement or a licensed SMPL mesh.</p>
    {clip && <><p role="status">{clip.model.toUpperCase()} · {clip.frames.length} frames · {clip.fps} fps · {clip.betas?.length ?? 0} betas</p>
      {clip.warnings.map(warning => <p key={warning}>{warning}</p>)}</>}
    {!clip && <p>Native meshes, learned shape deformation, fingers and face require licensed model assets and are unavailable here. Betas do not change this mesh.</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
