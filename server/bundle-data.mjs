export function dataGroup(name) {
 if(name.startsWith('.isp/'))return null;
 const relative=name.replace(/^project\//,'');
 if(/^(data|inputs|datasets)\//i.test(relative)||/\.(raw|bmp|png|jpe?g|webp|tiff?|npy|npz|h5|hdf5|exr|dng|bin)$/i.test(relative))return {id:name,label:name};
 return null;
}
export function bundleCategory(name){
 if(name.startsWith('.isp/viewer/'))return name.endsWith('.bin')?'Viewer 원본':'Viewer 크롭·정보';
 if(name.startsWith('.isp/artifacts/'))return 'Visualizations';
 if(dataGroup(name))return '입력·데이터셋';
 return '코드·그래프·스킬·기록';
}
