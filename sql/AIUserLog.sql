USE [Agtech_Usermgmt]
GO

/****** Object:  Table [dbo].[AIUsageLog]    Script Date: 6/17/2026 10:13:03 AM ******/
SET ANSI_NULLS ON
GO

SET QUOTED_IDENTIFIER ON
GO

CREATE TABLE [dbo].[AIUsageLog](
	[LogID] [bigint] IDENTITY(1,1) NOT NULL,
	[UserID] [int] NULL,
	[StoreID] [int] NULL,
	[RegOthID] [int] NULL,
	[TranscriptID] [int] NULL,
	[Module] [nvarchar](100) NULL,
	[Action] [nvarchar](100) NULL,
	[SessionID] [uniqueidentifier] NULL,
	[Operation] [nvarchar](100) NOT NULL,
	[Endpoint] [nvarchar](50) NULL,
	[Model] [nvarchar](100) NOT NULL,
	[PromptTokens] [int] NOT NULL,
	[CompletionTokens] [int] NOT NULL,
	[TotalTokens]  AS ([PromptTokens]+[CompletionTokens]) PERSISTED,
	[DurationSeconds] [decimal](10, 3) NULL,
	[CharCount] [int] NULL,
	[InputCostUsd] [decimal](14, 8) NOT NULL,
	[OutputCostUsd] [decimal](14, 8) NOT NULL,
	[TotalCostUsd]  AS ([InputCostUsd]+[OutputCostUsd]) PERSISTED,
	[Source] [nvarchar](20) NOT NULL,
	[CreatedAt] [datetime2](7) NOT NULL,
PRIMARY KEY CLUSTERED 
(
	[LogID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON) ON [PRIMARY]
) ON [PRIMARY]
GO

ALTER TABLE [dbo].[AIUsageLog] ADD  DEFAULT ((0)) FOR [PromptTokens]
GO

ALTER TABLE [dbo].[AIUsageLog] ADD  DEFAULT ((0)) FOR [CompletionTokens]
GO

ALTER TABLE [dbo].[AIUsageLog] ADD  DEFAULT ((0)) FOR [InputCostUsd]
GO

ALTER TABLE [dbo].[AIUsageLog] ADD  DEFAULT ((0)) FOR [OutputCostUsd]
GO

ALTER TABLE [dbo].[AIUsageLog] ADD  DEFAULT ('server') FOR [Source]
GO

ALTER TABLE [dbo].[AIUsageLog] ADD  DEFAULT (sysutcdatetime()) FOR [CreatedAt]
GO


