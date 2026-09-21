USE [Agtech_WHSMonitor]
GO

/****** Object:  Table [dbo].[_ControlsTable]    Script Date: 9/21/2026 3:21:37 PM ******/
SET ANSI_NULLS ON
GO

SET QUOTED_IDENTIFIER ON
GO

CREATE TABLE [dbo].[_ControlsTable](
	[ControlID] [bigint] IDENTITY(1,1) NOT NULL,
	[RecordGroupID] [int] NULL,
	[RecordGroup] [varchar](256) NULL,
	[ActionID] [int] NULL,
	[GroupID] [int] NULL,
	[GroupName] [varchar](256) NULL,
	[GroupTotal] [int] NULL,
	[HostID] [varchar](50) NULL,
	[CategoryID] [int] NULL,
	[Category] [varchar](256) NULL,
	[Comment] [varchar](4000) NULL,
	[Action] [varchar](4000) NULL,
	[PriorityID] [int] NULL,
	[Priority] [varchar](256) NULL,
	[ActionStatusID] [int] NULL,
	[ActionStatus] [varchar](256) NULL,
	[ResponsibleID] [int] NULL,
	[Responsible] [varchar](256) NULL,
	[ProjectID] [int] NULL,
	[Project] [varchar](512) NULL,
	[LocationTypeID] [int] NULL,
	[LocationType] [varchar](512) NULL,
	[LocationID] [int] NULL,
	[LocationName] [varchar](max) NULL,
	[DivisionID] [int] NULL,
	[Division] [varchar](256) NULL,
	[DepartmentID] [int] NULL,
	[Department] [varchar](256) NULL,
	[ProgrammeID] [int] NULL,
	[Programme] [varchar](2560) NULL,
	[CompletedOn] [datetime] NULL,
	[CompletedOnString] [varchar](256) NULL,
	[StartDate] [datetime] NULL,
	[StartDateString] [varchar](256) NULL,
	[Deadline] [datetime] NULL,
	[DeadlineString] [varchar](256) NULL,
	[StoreID] [int] NULL,
	[PageID] [int] NULL,
	[RefType] [varchar](256) NULL,
	[ParentID] [int] NULL,
	[RiskAssessmentTypeID] [int] NULL,
	[CreatedDt] [datetime] NULL,
	[CreatedById] [int] NULL,
	[EstCost] [varchar](100) NULL,
	[ReviewedById] [int] NULL,
	[ReviewedByName] [nvarchar](256) NULL,
	[ReviewedOn] [datetime] NULL,
	[ReviewedOnString] [nvarchar](256) NULL,
	[ApprovedById] [int] NULL,
	[ApprovedByName] [nvarchar](256) NULL,
	[ApprovedOn] [datetime] NULL,
	[ApprovedOnString] [nvarchar](256) NULL,
	[CompletedById] [int] NULL,
	[CompletedByName] [nvarchar](256) NULL,
	[ActionComments] [nvarchar](max) NULL,
	[NotifyTypeId] [int] NULL,
	[NotifyList] [nvarchar](max) NULL,
	[ReplyTo] [nvarchar](max) NULL,
	[UpdatedById] [int] NULL,
	[UpdateDt] [datetime] NULL,
	[UpdatedDt] [datetime] NULL,
	[OrignalDueDate] [datetime] NULL,
 CONSTRAINT [PK__ControlsTable] PRIMARY KEY CLUSTERED 
(
	[ControlID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON) ON [PRIMARY]
) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY]
GO


