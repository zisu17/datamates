-- event_id 단위 팩트. 같은 event_id 가 여러 배치로 들어오면 가장 큰 batch_id 만 남긴다.
-- Iceberg incremental merge 로 갱신되므로 정정 배치가 도착하면 기존 행이 update 된다.

{{
    config(
        materialized='incremental',
        incremental_strategy='merge',
        unique_key='event_id',
        file_format='iceberg',
    )
}}

with events as (

    select *
    from {{ ref('stg_events') }}
    where batch_id <= {{ var('max_batch_id') }}

    {% if is_incremental() %}
      and batch_id > (select coalesce(max(batch_id), 0) from {{ this }})
    {% endif %}

),

ranked as (

    select
        *,
        row_number() over (
            partition by event_id
            order by batch_id desc
        ) as _row_num
    from events

),

latest_per_event as (

    select
        event_id,
        event_ts,
        event_date,
        event_type,
        user_id,
        amount,
        batch_id
    from ranked
    where _row_num = 1

),

joined as (

    select
        e.event_id,
        e.event_ts,
        e.event_date,
        e.event_type,
        e.user_id,
        e.amount,
        e.batch_id,
        t.event_category,
        t.is_billable
    from latest_per_event as e
    left join {{ ref('dim_event_types') }} as t
        on e.event_type = t.event_type

)

select * from joined
