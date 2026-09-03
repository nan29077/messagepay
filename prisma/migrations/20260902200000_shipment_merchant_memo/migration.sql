-- 배송 메모를 둘로 나눈다.
--   memo          : 이용자가 결제 화면에서 남긴 배송 요청 (가맹점은 읽기 전용)
--   merchant_memo : 가맹점 내부 메모 (이용자에게 보이지 않음)
-- 이전에는 한 컬럼을 공유해, 가맹점이 내부 메모를 저장하면 이용자의 배송 요청이 지워졌다.
ALTER TABLE "charge_shipment" ADD COLUMN "merchant_memo" TEXT;
