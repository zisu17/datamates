-- 싱귤러 테스트: 증분 merge 가 정정 배치를 실제로 반영했는지 검증한다.
--
-- fct_events 는 event_id 당 stg_events 의 최신 batch_id 행이어야 한다.
-- merge 가 insert 만 하고 update 를 놓치면 여기서 걸린다.

with expected as (

    select
        event_id,
        max(batch_id) as expected_batch_id
    from {{ ref('stg_events') }}
    where batch_id <= {{ var('max_batch_id') }}
    group by event_id

)

select
    f.event_id,
    f.batch_id          as actual_batch_id,
    e.expected_batch_id
from {{ ref('fct_events') }} as f
inner join expected as e
    on f.event_id = e.event_id
where f.batch_id <> e.expected_batch_id
