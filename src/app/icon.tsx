import { ImageResponse } from 'next/og';

export const size = { width: 64, height: 64 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#071426', borderRadius: 18 }}>
      <div style={{ width: 42, height: 31, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', borderRadius: 10, background: '#b7f34a' }}>
        <div style={{ width: 10, height: 18, borderRight: '4px solid #071426', borderBottom: '4px solid #071426', transform: 'rotate(45deg) translate(-2px, -2px)' }} />
      </div>
    </div>,
    { ...size },
  );
}
