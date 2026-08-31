import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#071426', borderRadius: 42 }}>
      <div style={{ width: 116, height: 86, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', borderRadius: 28, background: '#b7f34a' }}>
        <div style={{ width: 28, height: 48, borderRight: '11px solid #071426', borderBottom: '11px solid #071426', transform: 'rotate(45deg) translate(-5px, -6px)' }} />
      </div>
    </div>,
    { ...size },
  );
}
