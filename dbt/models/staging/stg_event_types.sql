with source as (

    select * from {{ ref('raw_event_types') }}

),

renamed as (

    select
        lower(trim(event_type))       as event_type,
        lower(trim(event_category))   as event_category,
        cast(is_billable as boolean)  as is_billable
    from source

)

select * from renamed
