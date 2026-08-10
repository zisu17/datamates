-- 싱귤러 테스트: 팩트와 스테이징의 건수 정합성.
--
-- fct_events 행 수 == stg_events 의 distinct event_id 수.
-- 증분 merge 가 중복 insert 를 만들거나 배치를 통째로 누락하면 여기서 걸린다.

with stg as (

    select count(distinct event_id) as event_count
    from {{ ref('stg_events') }}
    where batch_id <= {{ var('max_batch_id') }}

),

fct as (

    select count(*) as event_count
    from {{ ref('fct_events') }}

)

select
    stg.event_count as stg_event_count,
    fct.event_count as fct_event_count
from stg
cross join fct
where stg.event_count <> fct.event_count
