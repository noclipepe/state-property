// Mesh decimation with meshoptimizer (keeps SDF normals as attributes)
import { MeshoptSimplifier } from 'meshoptimizer';
await MeshoptSimplifier.ready;

export function simplifyMesh(mesh, targetTris, err) {
  const { positions: P, normals: N, indices } = mesh;
  const idx = indices instanceof Uint32Array ? indices : Uint32Array.from(indices);
  const [ni] = MeshoptSimplifier.simplifyWithAttributes(idx, P, 3, N, 3, [0.25, 0.25, 0.25], null,
    Math.min(idx.length, targetTris * 3), err, ['ErrorAbsolute', 'Prune']);
  const remap = new Int32Array(P.length / 3).fill(-1);
  let n = 0;
  for (let i = 0; i < ni.length; i++) if (remap[ni[i]] < 0) remap[ni[i]] = n++;
  const P2 = new Float32Array(n * 3), N2 = new Float32Array(n * 3);
  for (let v = 0; v < remap.length; v++) {
    const r = remap[v];
    if (r < 0) continue;
    P2[r * 3] = P[v * 3]; P2[r * 3 + 1] = P[v * 3 + 1]; P2[r * 3 + 2] = P[v * 3 + 2];
    N2[r * 3] = N[v * 3]; N2[r * 3 + 1] = N[v * 3 + 1]; N2[r * 3 + 2] = N[v * 3 + 2];
  }
  const I2 = new Uint32Array(ni.length);
  for (let i = 0; i < ni.length; i++) I2[i] = remap[ni[i]];
  return { positions: P2, normals: N2, indices: I2 };
}
