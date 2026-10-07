// Export only the scene's dependencies so its lazy namespace stays tree-shakeable.
export {
  AmbientLight, BoxGeometry, BufferGeometry, Color, DirectionalLight,
  Float32BufferAttribute, Group, InstancedMesh, Line, LineBasicMaterial,
  LineSegments, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D,
  OctahedronGeometry, PerspectiveCamera, Scene, SRGBColorSpace, TorusGeometry,
  Vector3, WebGLRenderer,
} from "three";
