// A scenegraph object node
/* eslint-disable guard-for-in */

// Define some locals
import {
  GL, Buffer, Program, draw, checkUniformValues, getUniformsTable,
  WebGLRenderingContext
} from '../webgl';
import Object3D from '../scenegraph/object-3d';
import {log, formatValue} from '../utils';
import Geometry from './geometry';
import assert from 'assert';

const MSG_INSTANCED_PARAM_DEPRECATED = `\
Warning: Model constructor: parameter "instanced" renamed to "isInstanced".
This will become a hard error in a future version of luma.gl.`;

const MSG_TEXTURES_PARAM_REMOVED =
  'Model: parameter "textures" removed. Use uniforms to set textures';

// TODO - experimental, not yet used
export class Material {
  constructor({shininess = 0, reflection = 0, refraction = 0} = {}) {
    this.shininess = shininess;
    this.reflection = reflection;
    this.refraction = refraction;
  }
}

// Model abstract O3D Class
export default class Model extends Object3D {

  constructor(gl, opts = {}) {
    opts = gl instanceof WebGLRenderingContext ? {...opts, gl} : gl;
    super(opts);
    this.init(opts);
  }

  /* eslint-disable max-statements  */
  /* eslint-disable complexity  */
  init({
    program,
    gl = null,
    vs = null,
    fs = null,
    geometry,
    material = null,
    textures,
    // Enables instanced rendering (needs shader support and extra attributes)
    isInstanced = false,
    instanceCount = 0,
    vertexCount = undefined,
    // Picking
    pickable = true,
    pick = null,
    // Extra uniforms and attributes (beyond geometry, material, camera)
    uniforms = {},
    attributes = {},
    render = null,
    onBeforeRender = () => {},
    onAfterRender = () => {},
    ...opts
  } = {}) {
    // assert(program || program instanceof Program);
    assert(geometry instanceof Geometry, 'Model needs a geometry');

    // set a custom program per o3d
    this.program = program || new Program(gl, {vs, fs});
    assert(this.program instanceof Program, 'Model needs a program');

    if (opts.instanced) {
      /* global console */
      /* eslint-disable no-console */
      console.warn(MSG_INSTANCED_PARAM_DEPRECATED);
      isInstanced = isInstanced || opts.instanced;
    }

    if (textures) {
      throw new Error(MSG_TEXTURES_PARAM_REMOVED);
    }

    // TODO - remove?
    this.buffers = {};
    this.userData = {};
    this.drawParams = {};
    this.dynamic = false;
    this.needsRedraw = true;

    this.material = material;

    // Attributes and buffers
    this.setGeometry(geometry);
    this.attributes = {};
    this.setAttributes(attributes);

    this.uniforms = {};
    this.setUniforms({
      ...this.program.defaultUniforms,
      ...uniforms
    });

    // instanced rendering
    this.isInstanced = isInstanced;
    this.instanceCount = instanceCount;
    this.vertexCount = vertexCount;

    // picking options
    this.pickable = Boolean(pickable);
    this.pick = pick || (() => false);

    this.onBeforeRender = onBeforeRender;
    this.onAfterRender = onAfterRender;
  }
  /* eslint-enable max-statements */
  /* eslint-enable complexity */

  destroy() {
    // TODO
  }

  get hash() {
    return `${this.id} ${this.$pickingIndex}`;
  }

  setNeedsRedraw(redraw = true) {
    this.needsRedraw = redraw;
    return this;
  }

  getNeedsRedraw({clearRedrawFlags = false} = {}) {
    let redraw = false;
    redraw = redraw || this.needsRedraw;
    this.needsRedraw = this.needsRedraw && !clearRedrawFlags;
    redraw = redraw || this.geometry.getNeedsRedraw({clearRedrawFlags});
    return redraw;
  }

  setInstanceCount(instanceCount) {
    assert(instanceCount !== undefined);
    this.instanceCount = instanceCount;
    return this;
  }

  getInstanceCount() {
    return this.instanceCount;
  }

  setVertexCount(vertexCount) {
    this.vertexCount = vertexCount;
    return this;
  }

  getVertexCount() {
    return this.vertexCount === undefined ?
      this.geometry.getVertexCount() : this.vertexCount;
  }

  isPickable() {
    return this.pickable;
  }

  setPickable(pickable = true) {
    this.pickable = Boolean(pickable);
    return this;
  }

  getProgram() {
    return this.program;
  }

  getGeometry() {
    return this.geometry;
  }

  setGeometry(geometry) {
    this.geometry = geometry;
    this._createBuffersFromAttributeDescriptors(this.geometry.getAttributes());
    this.setNeedsRedraw();
    return this;
  }

  getAttributes() {
    return this.attributes;
  }

  setAttributes(attributes = {}) {
    Object.assign(this.attributes, attributes);
    this._createBuffersFromAttributeDescriptors(attributes);
    this.setNeedsRedraw();
    return this;
  }

  getUniforms() {
    return this.uniforms;
  }

  setUniforms(uniforms = {}) {
    checkUniformValues(uniforms, this.id);
    Object.assign(this.uniforms, uniforms);
    this.setNeedsRedraw();
    return this;
  }

  draw({uniforms = {}, attributes = {}, settings = {}} = {}) {
    return this.render(uniforms);
  }

  // TODO - uniform names are too strongly linked camera <=> default shaders
  // At least all special handling is collected here.
  addViewUniforms(uniforms) {
    // TODO - special treatment of these parameters should be removed
    const {camera, viewMatrix, modelMatrix, ...otherUniforms} = uniforms;
    // Camera exposes uniforms that can be used directly in shaders
    const cameraUniforms = camera ? camera.getUniforms() : {};

    const viewUniforms = viewMatrix ?
      this.getCoordinateUniforms(viewMatrix, modelMatrix) : {};

    return {
      ...cameraUniforms,
      ...viewUniforms,
      ...otherUniforms
    };
  }

  /*
   * @param {Camera} opt.camera=
   * @param {Camera} opt.viewMatrix=
   */
  /* eslint-disable max-statements */
  render(uniforms = {}) {
    const resolvedUniforms = this.addViewUniforms(uniforms);

    this.setUniforms(resolvedUniforms);

    log.log(2, `>>> RENDERING MODEL ${this.id}`, this);

    this.setProgramState();

    this._logAttributesAndUniforms(3, resolvedUniforms);

    this.onBeforeRender();

    const drawParams = this.drawParams;
    if (drawParams.isInstanced && !this.isInstanced) {
      log.warn(0, 'Found instanced attributes on non-instanced model');
    }
    const {isIndexed, indexType} = drawParams;
    const {geometry, isInstanced, instanceCount} = this;
    draw(this.program.gl, {
      drawMode: geometry.drawMode,
      vertexCount: this.getVertexCount(),
      isIndexed,
      indexType,
      isInstanced,
      instanceCount
    });

    this.onAfterRender();

    this.unsetProgramState();

    this.setNeedsRedraw(false);

    log.log(2, `<<< RENDERING MODEL ${this.id} - complete`);

    return this;
  }

  setProgramState() {
    const {program} = this;
    program.use();
    this.drawParams = {};
    program.setBuffers(this.buffers, {drawParams: this.drawParams});
    program.setUniforms(this.uniforms);
    return this;
  }

  unsetProgramState() {
    // Ensures all vertex attributes are disabled and ELEMENT_ARRAY_BUFFER
    // is unbound
    this.program.unsetBuffers();
    return this;
  }

  // Makes sure buffers are created for all attributes
  // and that the program is updated with those buffers
  // TODO - do we need the separation between "attributes" and "buffers"
  // couldn't apps just create buffers directly?
  _createBuffersFromAttributeDescriptors(attributes) {
    const {program: {gl}} = this;

    for (const attributeName in attributes) {
      const attribute = attributes[attributeName];

      if (attribute instanceof Buffer) {
        this.buffers[attributeName] = attribute;
      } else {
        // Autocreate a buffer
        this.buffers[attributeName] =
          this.buffers[attributeName] || new Buffer(gl);

        const buffer = this.buffers[attributeName];
        buffer.setData({
          ...attribute,
          data: attribute.value,
          target: attribute.isIndexed ?
            GL.ELEMENT_ARRAY_BUFFER : GL.ARRAY_BUFFER
        });
      }
    }

    return this;
  }

  _logAttributesAndUniforms(priority = 3, uniforms = {}) {
    if (log.priority >= priority) {
      const attributeTable = this._getAttributesTable({
        header: `Attributes ${this.id}`,
        program: this.program,
        attributes: {
          ...this.geometry.attributes,
          ...this.attributes
        }
      });
      log.table(priority, attributeTable);

      const {table, unusedTable, unusedCount} = getUniformsTable({
        header: `Uniforms ${this.id}`,
        program: this.program,
        uniforms: {...this.uniforms, ...uniforms}
      });
      log.table(priority, table);
      log.log(priority, `${unusedCount || 'No'} unused uniforms `, unusedTable);
    }
  }

  // Todo move to attributes manager
  _getAttributesTable({
    attributes,
    header = 'Attributes',
    instanced,
    program
  } = {}) {
    assert(program);
    const attributeLocations = program._attributeLocations;
    const table = {[header]: {}};

    // Add used attributes
    for (const attributeName in attributeLocations) {
      const attribute = attributes[attributeName];
      const location = attributeLocations[attributeName];
      table[attributeName] = this._getAttributeEntry(attribute, location);
    }

    // Add any unused attributes
    for (const attributeName in attributes) {
      const attribute = attributes[attributeName];
      if (!table[attributeName]) {
        table[attributeName] = this._getAttributeEntry(attribute, null);
      }
    }

    return table;
  }

  _getAttributeEntry(attribute, location) {
    const round = num => Math.round(num * 10) / 10;

    let type = 'NOT PROVIDED';
    let instanced = 0;
    let size = 'N/A';
    let verts = 'N/A';
    let bytes = 'N/A';
    let value = 'N/A';

    if (attribute && location === null) {
      location = attribute.isIndexed ? 'ELEMENT_ARRAY_BUFFER' : 'NOT USED';
    }

    if (attribute instanceof Buffer) {
      const buffer = attribute;
      type = buffer.layout.type;
      instanced = buffer.layout.instanced;
      size = buffer.layout.size;
      verts = round(buffer.data.length / buffer.layout.size);
      bytes = buffer.data.length * buffer.data.BYTES_PER_ELEMENT;
    } else if (attribute) {
      type = attribute.value.constructor.name;
      instanced = attribute.instanced;
      size = attribute.size;
      verts = round(attribute.value.length / attribute.size);
      bytes = attribute.value.length * attribute.value.BYTES_PER_ELEMENT;
      value = attribute.value;
    }

    // Generate a type name by dropping Array from Float32Array etc.
    type = String(type).replace('Array', '');
    // Look for 'nt' to detect integer types, e.g. Int32Array, Uint32Array
    const isInteger = type.indexOf('nt') !== -1;

    location = `${location}${instanced ? ' [instanced]' : ''}`;

    return {
      Location: location,
      'Type Size x Verts = Bytes': `${type} ${size} x ${verts} = ${bytes}`,
      Value: formatValue(value, {size, isInteger})
    };
  }

  // DEPRECATED / REMOVED
  setTextures(textures = []) {
    throw new Error(
      'model.setTextures replaced: setUniforms({sampler2D: new Texture2D})');
  }
}
