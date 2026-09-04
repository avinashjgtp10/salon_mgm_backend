// paytmchecksum (github.com/paytm/Paytm_Node_Checksum) ships no type
// declarations of its own. Minimal ambient shim for the two functions the
// Paytm POS provider actually uses.
declare module 'paytmchecksum' {
  export function generateSignature(
    params: Record<string, unknown> | string,
    key: string,
  ): Promise<string>;

  export function verifySignature(
    params: Record<string, unknown> | string,
    key: string,
    checksum: string,
  ): Promise<boolean>;

  const PaytmChecksum: {
    generateSignature: typeof generateSignature;
    verifySignature: typeof verifySignature;
  };
  export default PaytmChecksum;
}
