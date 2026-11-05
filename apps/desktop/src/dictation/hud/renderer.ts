import type { HudModel } from "./model";
import { palette, TUNING } from "./scope";
import { FRAGMENT_SHADER, VERTEX_SHADER } from "./shader";

const UNIFORMS = [
  "metrics0",
  "metrics1",
  "metrics2",
  "state",
  "base",
  "core",
  "plate",
  "rim",
  "shadow",
] as const;

/** Draws Dot scope into a WebGL2 canvas sized in CSS points. */
export function createHudRenderer(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
  });
  if (!gl) return null;

  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader) ?? "shader failed");
    }
    return shader;
  };
  const program = gl.createProgram()!;
  gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX_SHADER));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) ?? "program failed");
  }
  const location = Object.fromEntries(
    UNIFORMS.map((name) => [name, gl.getUniformLocation(program, name)]),
  ) as Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>;

  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RG32F,
    TUNING.columns,
    TUNING.rows,
    0,
    gl.RG,
    gl.FLOAT,
    null,
  );
  const vertices = gl.createVertexArray();

  return {
    draw(model: HudModel, dark: boolean, scale: number) {
      const width = Math.round(canvas.clientWidth * scale);
      const height = Math.round(canvas.clientHeight * scale);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const scope = model.scope;
      const pose = scope.pose();
      const colors = palette(dark, pose);
      gl.viewport(0, 0, width, height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.bindVertexArray(vertices);
      gl.uniform4f(location.metrics0, width, height, scale, TUNING.spacing);
      gl.uniform4f(
        location.metrics1,
        pose.width,
        pose.height,
        pose.opacity,
        pose.scale,
      );
      gl.uniform4f(
        location.metrics2,
        pose.softness,
        scope.columns,
        scope.rows,
        pose.height / 2,
      );
      gl.uniform4f(location.state, pose.glow, pose.grid, pose.live, pose.cool);
      gl.uniform4f(location.base, ...colors.base, dark ? 1 : 0);
      gl.uniform4f(location.core, ...colors.core, 1);
      gl.uniform4fv(location.plate, colors.plate);
      gl.uniform4fv(location.rim, colors.rim);
      gl.uniform4fv(location.shadow, colors.shadow);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        scope.columns,
        scope.rows,
        gl.RG,
        gl.FLOAT,
        scope.dots,
      );
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  };
}
