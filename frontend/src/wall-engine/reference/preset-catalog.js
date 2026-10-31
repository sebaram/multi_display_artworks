// IDs are append-only: saved looks retain the original eight scene numbers.
export const kineticPresets=Object.freeze([
 {id:8,type:'presence',name:'Co-presence',tag:'Interwoven ribbons',tone:'#91c9f4',desc:'Distinct red and blue ribbons weave around a shared core, with contributions circulating in depth.',use:'Continuous 3D motion',meaning:0,light:false,background:'#050a16',glow:'#388fff'},
 {id:9,type:'registration',name:'Shared coordinates',tag:'Kinetic portals',tone:'#ddd3b9',desc:'Physical and virtual portals articulate, align and open a shared passage while scanning guides turn in depth.',use:'Continuous 3D motion',meaning:2,light:true,background:'#c7c7bd',glow:'#e5dfcd'},
 {id:10,type:'feedback',name:'Mutual response',tag:'Travelling waves',tone:'#a2ded1',desc:'Two rippling surfaces exchange signals and replies along a three-dimensional path.',use:'Continuous 3D motion',meaning:3,light:false,background:'#0b2029',glow:'#4eb6b0'},
 {id:11,type:'cocreation',name:'Co-creation',tag:'Unfolding structure',tone:'#ff9687',desc:'Complementary bays hinge into a shared pavilion while contribution panels orbit and turn.',use:'Continuous 3D motion',meaning:1,light:false,background:'#111626',glow:'#e36b88'}
].map(Object.freeze));
export const PRESET_COUNT=8+kineticPresets.length;
