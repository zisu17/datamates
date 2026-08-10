-- 원천 이벤트 정규화. 그레인은 (event_id, batch_id) 로 유지한다.
-- 중복 제거는 여기서 하지 않고 fct_events 에서 처리한다.

with source as (

    select * from {{ ref('raw_events') }}

),

renamed as (

    select
        cast(event_id as bigint)        as event_id,
        cast(event_ts as timestamp)     as event_ts,
        cast(event_ts as date)          as event_date,
        lower(trim(event_type))         as event_type,
        -- 원천의 익명 센티널을 null 로 정규화한다. 스테이징 계층의 전형적인 역할.
        --
        -- 참고: seed CSV 의 셀을 아예 비워두는 방식은 쓰지 않는다. dbt-spark 의
        -- `method: session`(로컬) 경로는 파라미터 바인딩을 문자열 포매팅으로 처리해서
        -- (session.py `_fix_binding`) Python None 을 NULL 이 아니라 길이 4 의 문자열
        -- 'None' 으로 적재한다. `method: thrift`(원격) 경로는 PyHive 가 제대로 NULL 로
        -- 넘기므로 같은 seed 가 로컬과 원격에서 다르게 들어온다.
        nullif(nullif(trim(user_id), ''), 'ANONYMOUS') as user_id,
        cast(amount as decimal(10, 2))  as amount,
        cast(batch_id as int)           as batch_id
    from source

)

select * from renamed
