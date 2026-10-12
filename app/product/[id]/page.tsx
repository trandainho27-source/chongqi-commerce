import Store from '../../store';
export default async function Page({params}:{params:Promise<{id:string}>}){const {id}=await params;return <Store initialProduct={id}/>;}
