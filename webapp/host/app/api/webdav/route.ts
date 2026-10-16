import {handleDavRelay} from '../../../webapp/relay.mjs';
export const dynamic='force-dynamic';
export const POST=(request:Request)=>handleDavRelay(request);
