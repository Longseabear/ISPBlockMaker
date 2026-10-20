// Optional payloads are selected as complete reference sets or individual input files.
export function dataGroup(name) {
 const reference=name.match(/^\.isp\/reference-sets\/([^/]+)\//);
 if(reference)return {id:'.isp/reference-sets/'+reference[1]+'/',label:'Reference I/O · '+reference[1]};
 if(name.startsWith('.isp/'))return null;
 const relative=name.replace(/^project\//,'');
 if(/^(data|inputs|datasets)\//i.test(relative)||/\.(raw|bmp|png|jpe?g|webp|tiff?|npy|npz|h5|hdf5|exr|dng|bin)$/i.test(relative))return {id:name,label:name};
 return null;
}
export function bundleCategory(name){
 if(name.startsWith('.isp/reference-sets/'))return 'Reference I/O';
 if(name.startsWith('.isp/viewer/'))return name.endsWith('.bin')?'Viewer 원본':'Viewer 크롭·정보';
 if(name.startsWith('.isp/artifacts/'))return 'Visualizations';
 if(dataGroup(name))return '입력·데이터셋';
 return '코드·그래프·스킬·기록';
}
