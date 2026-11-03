/** Protects expensive, unauthenticated official TFG upstream reads.
 * Counters are Cloudflare-native, per PoP and approximate (not a global quota).
 * Do not write bookings, IP addresses, identifiers or counters to KV/logs.
 */
export const RATE_BINDINGS=Object.freeze({
 booking:Object.freeze({client:'BOOKING_CLIENT_LIMIT',global:'BOOKING_GLOBAL_LIMIT'}),
 tfg:Object.freeze({client:'TFG_CLIENT_LIMIT',global:'TFG_GLOBAL_LIMIT'})
});
/** Missing native protection must not turn into unlimited TFG upstream requests.
 * An undefined env is allowed only for locally invoked test fixtures; a
 * deployed Worker always receives an env object.
 */
export async function protectTfgRequest(request,env,route){
 if(env===undefined)return {allowed:true};
 const names=RATE_BINDINGS[route];
 if(!names)throw Error('INVALID_RATE_ROUTE');
 const client=env?.[names.client],global=env?.[names.global];
 if(typeof client?.limit!=='function'||typeof global?.limit!=='function')
  return {allowed:false,status:503,error:'RATE_LIMIT_UNAVAILABLE'};
 // Cloudflare populates this header at the edge; never trust X-Forwarded-For.
 // Mobile carrier NAT may share IPs, so limits are intentionally generous.
 const ip=request.headers.get('CF-Connecting-IP');
 const key=ip&&ip.length<=64?ip:'unidentified-client';
 try{
  const local=await client.limit({key});
  if(local?.success!==true)return {allowed:false,status:429,error:'RATE_LIMITED'};
  // Upper bound on the entire route from one Cloudflare location, even if
  // a bot rotates client IPs. Cloudflare counters are approximate.
  const site=await global.limit({key:route});
  if(site?.success!==true)return {allowed:false,status:429,error:'RATE_LIMITED'};
  return {allowed:true};
 }catch{
  return {allowed:false,status:503,error:'RATE_LIMIT_UNAVAILABLE'};
 }
}
